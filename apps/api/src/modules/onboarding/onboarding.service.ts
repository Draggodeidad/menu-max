import {
  ACCOUNT_ALREADY_EXISTS_MESSAGE,
  MODES_REQUIRED,
  TABLES_REQUIRED,
  type OnboardingDto,
  type OnboardingInput,
} from "@menu-max/contracts";
import type { Env } from "../../env";
import type { Db } from "../../infrastructure/db";
import { TURNSTILE_HEADER, verifyTurnstile } from "../../infrastructure/turnstile";
import { assertDeliverableEmail, normalizeEmail } from "../../shared/email-checks";
import { AppError } from "../../shared/errors";
import { findStoredResponse, requestHash, storeResponseStatements } from "../../shared/idempotency";
import { newId } from "../../shared/ids";
import { log } from "../../shared/log";
import { hit } from "../../shared/rate-counters";
import type { AuthUser } from "../auth/auth";
import { createOwnerAccount, notifyExistingAccount } from "../auth/auth.service";
import { listMemberships } from "../organizations/organizations.service";
import { qrUrl, withAvailableSlug } from "../storefront/storefront.service";
import { planMaxProducts } from "../subscriptions/subscriptions.service";
import { onboardingStatements } from "./onboarding.repository";

// Prueba de 3 meses (Release 1, acordado 2026-11-14): toda organización nueva opera 90 días con
// `pro` sin costo. Los límites se leen de `plans`; el paso a `free` al vencer es la T20b.
export const TRIAL_PLAN_ID = "pro";
export const TRIAL_DAYS = 90;
/** El menú inicial debe caber en el plan al que pasará la cuenta al terminar la prueba. */
export const POST_TRIAL_PLAN_ID = "free";
export const ONBOARDING_SCOPE = "onboarding";
export const FIRST_CATEGORY_NAME = "Menú";

const DAY_MS = 24 * 60 * 60 * 1000;
// Crear cuenta: 3 por día por IP (ADR-010), ventana fija en UTC.
const SIGNUPS_PER_IP_PER_DAY = 3;

export const SIGNUP_LIMIT_MESSAGE =
  "Ya se crearon varias cuentas desde esta conexión hoy. Inténtalo de nuevo mañana.";
export const OTHER_ACCOUNT_MESSAGE =
  "Ya entraste con otra cuenta. Sal de ella o usa su correo para publicar tu menú.";
export const ALREADY_ONBOARDED_MESSAGE =
  "Tu cuenta ya tiene un negocio. Entra a tu panel para editar tu menú.";

export type OnboardingDeps = {
  db: Db;
  env: Env;
  requestId: string;
  clientIp: string | undefined;
  user: AuthUser | null;
  headers: Headers;
  waitUntil: (promise: Promise<unknown>) => void;
  /**
   * Recibe las cookies de la sesión nueva en cuanto Better Auth crea la cuenta: si el batch falla
   * después, la respuesta de error también abre la sesión y el reintento entra por `/app`.
   */
  onSession: (setCookies: string[]) => void;
};

export type OnboardingResult = { statusCode: number; body: OnboardingDto; replayed: boolean };

function assertValidSettings(input: OnboardingInput) {
  const { modes } = input;
  if (!modes.table && !modes.pickup && !modes.delivery) {
    throw new AppError("VALIDATION_FAILED", MODES_REQUIRED, { modes: [MODES_REQUIRED] });
  }
  if (modes.table && (input.tableCount ?? 0) < 1) {
    throw new AppError("VALIDATION_FAILED", TABLES_REQUIRED, { tableCount: [TABLES_REQUIRED] });
  }
}

async function assertProductsFit(deps: OnboardingDeps, count: number) {
  const max = await planMaxProducts(deps.db, POST_TRIAL_PLAN_ID, deps.requestId);
  if (count <= max) return;
  const message = `Puedes publicar hasta ${max} productos al crear tu menú. Agrega los demás desde tu panel.`;
  throw new AppError("VALIDATION_FAILED", message, { products: [message] });
}

async function consumeSignupQuota(deps: OnboardingDeps) {
  const quota = await hit(
    deps.db,
    `signup-ip:${deps.clientIp ?? "unknown"}`,
    DAY_MS,
    SIGNUPS_PER_IP_PER_DAY,
  );
  if (quota.allowed) return;
  log.warn("onboarding.quota_exceeded", { requestId: deps.requestId });
  throw new AppError("RATE_LIMITED", SIGNUP_LIMIT_MESSAGE, undefined, quota.retryAfterMs / 1000);
}

/**
 * Correo ya registrado: avisa a su dueño (T20c, sujeto a su cuota y después de responder) y
 * devuelve el mismo `409` que T20, que no dice si el aviso salió.
 */
function rejectExistingAccount(deps: OnboardingDeps, email: string) {
  notifyExistingAccount(deps, email);
  return new AppError("CONFLICT", ACCOUNT_ALREADY_EXISTS_MESSAGE);
}

function replay(deps: OnboardingDeps, stored: { statusCode: number; body: unknown }) {
  log.info("onboarding.replayed", { requestId: deps.requestId });
  return { statusCode: stored.statusCode, body: stored.body as OnboardingDto, replayed: true };
}

/**
 * Alta en un solo envío (T20): cuenta, organización, negocio, sucursal, menú publicado con sus
 * productos y suscripción de prueba. Orden:
 *
 * 1. Reglas del cuerpo que Zod no cubre (modalidades, tope de productos de `free`).
 * 2. Turnstile → cuota de 3 altas por IP al día → correo entregable (ADR-008, ADR-010).
 * 3. Idempotencia (ADR-013) antes de crear la cuenta, para no dejar una cuenta huérfana con una
 *    llave ajena: otro cuerpo → `IDEMPOTENCY_CONFLICT`. El hash no lleva la contraseña y sí el
 *    correo normalizado, que ata la llave a su cuenta.
 * 4. Con sesión (reanudación tras un batch fallido o reintento): el correo debe ser el de la
 *    sesión; misma llave y mismo cuerpo → la misma respuesta; si la cuenta ya tiene organización
 *    → `CONFLICT`. Sin sesión: la llave ya registrada → `CONFLICT` (la cuenta existe; no se
 *    entrega la respuesta sin sesión); si no, Better Auth crea la cuenta y encola `verify-email`,
 *    y un correo ya registrado → `CONFLICT`. En los dos `CONFLICT` sin sesión se avisa al correo
 *    registrado (`account-exists`, T20c).
 * 5. Un solo `db.batch` con todo y el registro de la llave. Si falla, la cuenta queda con sesión
 *    y sin organización: el reintento con la misma llave entra por el paso 4 con sesión.
 */
export async function onboard(
  deps: OnboardingDeps,
  idempotencyKey: string,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  assertValidSettings(input);
  await assertProductsFit(deps, input.products.length);

  await verifyTurnstile(deps.env, deps.headers.get(TURNSTILE_HEADER), deps.clientIp);
  await consumeSignupQuota(deps);
  const email = await assertDeliverableEmail(
    { db: deps.db, requestId: deps.requestId },
    input.account.email,
  );

  const hash = await requestHash(ONBOARDING_SCOPE, { ...input, account: { email } });
  let userId: string;
  if (deps.user) {
    if (normalizeEmail(deps.user.email) !== email) {
      throw new AppError("CONFLICT", OTHER_ACCOUNT_MESSAGE);
    }
    const stored = await findStoredResponse(deps.db, idempotencyKey, ONBOARDING_SCOPE, hash);
    if (stored) return replay(deps, stored);
    if ((await listMemberships(deps.db, deps.user.id)).length > 0) {
      throw new AppError("CONFLICT", ALREADY_ONBOARDED_MESSAGE);
    }
    userId = deps.user.id;
  } else {
    // Sin sesión no se entrega una respuesta guardada: la cuenta de esa llave ya existe.
    if (await findStoredResponse(deps.db, idempotencyKey, ONBOARDING_SCOPE, hash)) {
      throw rejectExistingAccount(deps, email);
    }
    const account = await createOwnerAccount(
      { env: deps.env, requestId: deps.requestId, waitUntil: deps.waitUntil },
      deps.headers,
      { email, name: input.businessName, password: input.account.password },
    ).catch((error: unknown) => {
      // `createOwnerAccount` solo responde `CONFLICT` cuando el correo ya está registrado.
      if (error instanceof AppError && error.code === "CONFLICT") {
        throw rejectExistingAccount(deps, email);
      }
      throw error;
    });
    deps.onSession(account.setCookies);
    userId = account.userId;
    log.info("onboarding.account_created", { requestId: deps.requestId });
  }

  const now = new Date();
  const ids = {
    orgId: newId(),
    memberId: newId(),
    subscriptionId: newId(),
    businessId: newId(),
    branchId: newId(),
    menuId: newId(),
    categoryId: newId(),
    themeId: newId(),
  };

  try {
    return await withAvailableSlug(deps.db, input.businessName, async (slug) => {
      const body: OnboardingDto = {
        orgId: ids.orgId,
        branchId: ids.branchId,
        menuSlug: slug,
        menuUrl: qrUrl(deps.env.WEB_ORIGIN, slug),
      };
      const response = { statusCode: 201, body };
      await deps.db.batch([
        ...onboardingStatements(deps.db, {
          ids,
          userId,
          businessName: input.businessName,
          branch: {
            modes: input.modes,
            tableCount: input.tableCount ?? 0,
            alertWhatsapp: input.alertWhatsapp ?? null,
          },
          trial: {
            planId: TRIAL_PLAN_ID,
            periodEnd: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
          },
          slug,
          categoryName: FIRST_CATEGORY_NAME,
          products: input.products.map((product) => ({ id: newId(), ...product })),
          now,
        }),
        ...storeResponseStatements(deps.db, {
          key: idempotencyKey,
          orgId: ids.orgId,
          scope: ONBOARDING_SCOPE,
          hash,
          response,
          now: now.getTime(),
        }),
      ]);
      log.info("onboarding.completed", { requestId: deps.requestId, orgId: ids.orgId });
      return { ...response, replayed: false };
    });
  } catch (error) {
    // Otra petición con la misma llave pudo completar el alta entre la consulta y el batch.
    const winner = await findStoredResponse(deps.db, idempotencyKey, ONBOARDING_SCOPE, hash);
    if (winner) return replay(deps, winner);
    log.error("onboarding.batch_failed", { requestId: deps.requestId });
    throw error;
  }
}
