import type { EmailSendJob, PlanUsage, SubscriptionDto } from "@menu-max/contracts";
import type { Env } from "../../env";
import type { Db } from "../../infrastructure/db";
import { enqueue } from "../../infrastructure/jobs";
import { AppError } from "../../shared/errors";
import { newId } from "../../shared/ids";
import { log } from "../../shared/log";
import type { TenantContext } from "../../types";
import { settingsLink } from "../auth/web-links";
import { listOwnerRecipients } from "../organizations/organizations.service";
import { menusVersionBumpStatement } from "../storefront/storefront.service";
import {
  clearTrialEndedNoticeStatement,
  countUsageByOrganization,
  endTrialsStatement,
  findExpiredTrials,
  findMemberLimit,
  findPendingTrialEndedNotices,
  findPlan,
  findPlanMaxProducts,
  findSubscriptionWithUsage,
  findTrialsDueForNotice,
  markTrialNoticeStatement,
  memberSlotAvailable,
  type TrialNotice,
} from "./subscriptions.repository";

export type SubscriptionDeps = { db: Db; tenant: TenantContext; requestId: string };

/** Toda organización tiene suscripción desde su alta (T20); si falta, es un dato corrupto. */
export function missingSubscription(requestId: string, orgId: string) {
  log.error("subscription.missing", { requestId, orgId });
  return new AppError("INTERNAL");
}

/** Plan, estado, límites y uso actual de la organización. */
export async function getSubscription(deps: SubscriptionDeps): Promise<SubscriptionDto> {
  const row = await findSubscriptionWithUsage(deps.db, deps.tenant);
  if (!row) throw missingSubscription(deps.requestId, deps.tenant.orgId);
  return {
    plan: { id: row.planId, name: row.planName },
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    limits: {
      maxBranches: row.maxBranches,
      maxProducts: row.maxProducts,
      maxMembers: row.maxMembers,
    },
    features: { customTheme: row.customTheme, removeBranding: row.removeBranding },
    usage: row.usage,
  };
}

export const MEMBER_LIMIT_ON_ACCEPT_MESSAGE =
  "Este equipo ya alcanzó el límite de miembros de su plan. Pide a quien te invitó que libere un lugar o cambie de plan.";

/**
 * Para aceptar una invitación (ruta pública, sin tenant): `PLAN_LIMIT_REACHED` si la
 * organización ya no tiene lugar para otro miembro activo.
 */
export async function assertMemberSlotForInvitation(db: Db, orgId: string, requestId: string) {
  const members = await findMemberLimit(db, orgId);
  if (!members) throw missingSubscription(requestId, orgId);
  if (members.used >= members.limit) {
    throw new AppError("PLAN_LIMIT_REACHED", MEMBER_LIMIT_ON_ACCEPT_MESSAGE);
  }
}

/** Condición SQL para la sentencia que agrega al miembro (cierra la carrera entre aceptaciones). */
export function memberSlotCondition(db: Db, orgId: string) {
  return memberSlotAvailable(db, orgId);
}

/**
 * Tope de productos del plan, leído de `plans` (el onboarding usa el de `free`, T20). Si el plan
 * no existe, la siembra de la migración está rota.
 */
export async function planMaxProducts(db: Db, planId: string, requestId: string) {
  const max = await findPlanMaxProducts(db, planId);
  if (max === undefined) {
    log.error("subscription.plan_missing", { requestId, planId });
    throw new AppError("INTERNAL");
  }
  return max;
}

// Fin de la prueba (T20b) ---------------------------------------------------------------------
// Tareas del Cron diario. Orden obligatorio: primero se encola el correo y después se marca. Si
// encolar falla, la marca no se escribe y la siguiente corrida lo reintenta; si falla la marca, el
// aviso puede repetirse una vez (at least once), pero nunca se da por enviado uno que no salió.

/** Plan al que pasa una prueba vencida. Sus límites y capacidades se leen de `plans`. */
export const TRIAL_FALLBACK_PLAN_ID = "free";

/** Días antes del fin de la prueba. Las ventanas no se traslapan: el de 15 exige más de 3 días. */
const TRIAL_NOTICES: readonly TrialNotice[] = [15, 3];

/**
 * Suscripciones por consulta. D1 admite 100 parámetros por sentencia y las que llevan
 * `inArray(ids)` suman algunos más, así que el lote queda por debajo de 100.
 */
export const TRIAL_BATCH_SIZE = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialCronDeps = { db: Db; env: Env; requestId: string };

type TrialMailData = { trialEndsAt: string; daysLeft: number } | undefined;

type PlanSummary = {
  planName: string;
  limits: { maxBranches: number; maxProducts: number; maxMembers: number };
  features: { customTheme: boolean; removeBranding: boolean };
};

async function planSummary(deps: TrialCronDeps, planId: string): Promise<PlanSummary> {
  const plan = await findPlan(deps.db, planId);
  if (!plan) {
    log.error("subscription.plan_missing", { requestId: deps.requestId, planId });
    throw new Error(`Falta el plan ${planId} en \`plans\``);
  }
  return {
    planName: plan.name,
    limits: {
      maxBranches: plan.maxBranches,
      maxProducts: plan.maxProducts,
      maxMembers: plan.maxMembers,
    },
    features: { customTheme: plan.customTheme, removeBranding: plan.removeBranding },
  };
}

/**
 * Encola el correo de fin de prueba a cada dueño entregable de la organización. `true` si todos
 * se encolaron (o no había a quién avisar); `false` si alguno falló y el aviso debe reintentarse.
 */
async function notifyOwners(
  deps: TrialCronDeps,
  orgId: string,
  emails: string[],
  data: PlanSummary & { usage: PlanUsage },
  ending: TrialMailData,
): Promise<boolean> {
  const url = settingsLink(deps.env);
  const jobFor = (to: string): EmailSendJob =>
    ending
      ? {
          type: "email.send",
          id: newId(),
          to,
          template: "trial-ending",
          data: { url, ...data, ...ending },
        }
      : { type: "email.send", id: newId(), to, template: "trial-ended", data: { url, ...data } };
  try {
    await Promise.all(emails.map((to) => enqueue(deps.env, jobFor(to))));
    return true;
  } catch (error) {
    log.error("subscription.trial_notice_failed", {
      requestId: deps.requestId,
      orgId,
      notice: ending ? ending.daysLeft : "ended",
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

type Sweep = { notified: number; skipped: number; failed: number };

/**
 * Avisa a los dueños de cada suscripción del lote y devuelve las que quedaron resueltas (avisadas
 * o sin dueños entregables). Las que fallaron quedan fuera para reintentarse.
 */
async function notifyBatch<Row extends { id: string; organizationId: string }>(
  deps: TrialCronDeps,
  rows: Row[],
  plan: (row: Row) => Promise<PlanSummary>,
  ending: (row: Row) => TrialMailData,
  event: { name: string; notice: number | "ended" },
  sweep: Sweep,
): Promise<Row[]> {
  const orgIds = rows.map((row) => row.organizationId);
  const [recipients, usageOf] = await Promise.all([
    listOwnerRecipients(deps.db, orgIds),
    countUsageByOrganization(deps.db, orgIds),
  ]);
  const done: Row[] = [];
  await Promise.all(
    rows.map(async (row) => {
      const emails = recipients.get(row.organizationId) ?? [];
      const context = {
        requestId: deps.requestId,
        orgId: row.organizationId,
        notice: event.notice,
      };
      if (emails.length === 0) {
        // Sin dueños con correo entregable no hay a quién reintentar: se da por resuelto.
        log.warn("subscription.trial_notice_skipped", context);
        sweep.skipped += 1;
        done.push(row);
        return;
      }
      const data = { ...(await plan(row)), usage: usageOf(row.organizationId) };
      const sent = await notifyOwners(deps, row.organizationId, emails, data, ending(row));
      if (!sent) {
        sweep.failed += 1;
        return;
      }
      log.info(event.name, { ...context, recipients: emails.length });
      sweep.notified += 1;
      done.push(row);
    }),
  );
  return done;
}

async function runStatements(db: Db, statements: Parameters<Db["batch"]>[0][number][]) {
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

/**
 * Recorre una consulta por lotes con cursor por `id`, uno detrás de otro: cada lote se pide
 * después de procesar el anterior. Recursivo para no esperar dentro de un ciclo.
 */
async function forEachBatch<Row extends { id: string }>(
  fetch: (cursor: string | undefined) => Promise<Row[]>,
  handle: (rows: Row[]) => Promise<void>,
  cursor?: string,
): Promise<void> {
  const rows = await fetch(cursor);
  if (rows.length === 0) return;
  await handle(rows);
  if (rows.length < TRIAL_BATCH_SIZE) return;
  await forEachBatch(fetch, handle, rows.at(-1)?.id);
}

const emptySweep = (): Sweep => ({ notified: 0, skipped: 0, failed: 0 });

/** Avisos previos de 15 y 3 días a las suscripciones `trialing` (ver `findTrialsDueForNotice`). */
export async function sendTrialNotices(deps: TrialCronDeps, now: number): Promise<Sweep> {
  const sweep = emptySweep();
  const fallback = await planSummary(deps, TRIAL_FALLBACK_PLAN_ID);
  await Promise.all(
    TRIAL_NOTICES.map((notice) =>
      forEachBatch(
        (cursor) => findTrialsDueForNotice(deps.db, notice, now, cursor, TRIAL_BATCH_SIZE),
        async (rows) => {
          const done = await notifyBatch(
            deps,
            rows,
            () => Promise.resolve(fallback),
            (row) => {
              const end = row.currentPeriodEnd ?? new Date(now);
              const days = Math.ceil((end.getTime() - now) / DAY_MS);
              return {
                trialEndsAt: end.toISOString(),
                daysLeft: Math.min(Math.max(days, 1), notice),
              };
            },
            { name: "subscription.trial_notice_sent", notice },
            sweep,
          );
          await runStatements(
            deps.db,
            done.map((row) => markTrialNoticeStatement(deps.db, row.id, notice, now)),
          );
        },
      ),
    ),
  );
  return sweep;
}

/**
 * Pasa a `free` + `active` las pruebas vencidas, sin borrar ni ocultar nada: lo que excede el
 * plan sigue operando y `assertWithinLimit` solo bloquea nuevas altas. En el mismo `db.batch`
 * sube `menuVersion` de sus menús, porque el tema público depende del plan (ADR-014).
 */
export async function endExpiredTrials(deps: TrialCronDeps, now: number): Promise<number> {
  let ended = 0;
  await forEachBatch(
    (cursor) => findExpiredTrials(deps.db, now, cursor, TRIAL_BATCH_SIZE),
    async (rows) => {
      const [changed] = await deps.db.batch([
        endTrialsStatement(
          deps.db,
          rows.map((row) => row.id),
          TRIAL_FALLBACK_PLAN_ID,
          now,
        ),
        menusVersionBumpStatement(
          deps.db,
          rows.map((row) => row.organizationId),
        ),
      ]);
      for (const { organizationId } of changed) {
        log.info("subscription.trial_ended", {
          requestId: deps.requestId,
          orgId: organizationId,
          planId: TRIAL_FALLBACK_PLAN_ID,
        });
      }
      ended += changed.length;
    },
  );
  return ended;
}

/** Encola `trial-ended` a las suscripciones con el aviso pendiente y solo entonces lo resuelve. */
export async function sendTrialEndedNotices(deps: TrialCronDeps, now: number): Promise<Sweep> {
  const sweep = emptySweep();
  const plans = new Map<string, Promise<PlanSummary>>();
  const planOf = (planId: string) => {
    const cached = plans.get(planId) ?? planSummary(deps, planId);
    plans.set(planId, cached);
    return cached;
  };
  await forEachBatch(
    (cursor) => findPendingTrialEndedNotices(deps.db, cursor, TRIAL_BATCH_SIZE),
    async (rows) => {
      const done = await notifyBatch(
        deps,
        rows,
        (row) => planOf(row.planId),
        () => undefined,
        { name: "subscription.trial_ended_notice_sent", notice: "ended" },
        sweep,
      );
      await runStatements(
        deps.db,
        done.flatMap((row) =>
          row.pendingAt
            ? [clearTrialEndedNoticeStatement(deps.db, row.id, row.pendingAt, now)]
            : [],
        ),
      );
    },
  );
  return sweep;
}
