import {
  ErrorResponse,
  MeDto,
  OnboardingDto,
  PublicMenuDto,
  SubscriptionDto,
  type JobMessage,
} from "@menu-max/contracts";
import {
  branches,
  categories,
  idempotencyKeys,
  menus,
  organizationMembers,
  plans,
  storefrontThemes,
  users,
} from "@menu-max/database";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrg, createUser } from "../../../test/factories";
import { callApi } from "../../../test/isolation";
import { getEnv } from "../../env";
import { createDb } from "../../infrastructure/db";
import { newId } from "../../shared/ids";
import { notifyExistingAccount } from "../auth/auth.service";
import { TRIAL_DAYS } from "./onboarding.service";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DAY_MS = 24 * 60 * 60 * 1000;
const password = "Contraseña de prueba 4817";
/** Dominios sin MX ni A en el DoH simulado. */
const NO_MAIL_DOMAIN = "sin-correo.example.com";

beforeEach(() => {
  const usedTurnstile = new Set<string>();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === SITEVERIFY) {
      // Clave de prueba que siempre pasa, salvo tokens reutilizados o el de "siempre falla".
      const form = init?.body;
      const token = form instanceof FormData ? String(form.get("response")) : "";
      const rejected = usedTurnstile.has(token) || token === "2x0000000000000000000000000000000AA";
      usedTurnstile.add(token);
      return Promise.resolve(
        Response.json(
          rejected
            ? { success: false, "error-codes": ["timeout-or-duplicate"] }
            : { success: true, "error-codes": [] },
        ),
      );
    }
    if (url.origin === "https://cloudflare-dns.com") {
      const answers =
        url.searchParams.get("name") === NO_MAIL_DOMAIN
          ? []
          : [{ type: 15, data: "10 mx.example.com." }];
      return Promise.resolve(Response.json({ Status: 0, Answer: answers }));
    }
    // haveIBeenPwned: ninguna contraseña de prueba está filtrada.
    if (url.origin === "https://api.pwnedpasswords.com") return Promise.resolve(new Response(""));
    throw new Error("Petición externa inesperada.");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const db = () => createDb(getEnv(env));
const newEmail = (domain = "example.com") => `duena-${crypto.randomUUID()}@${domain}`;

function onboardingBody(overrides: Record<string, unknown> = {}) {
  return {
    businessName: "Tacos El Güero",
    products: [
      { name: "Taco al pastor", priceCents: 2500 },
      { name: "Agua de horchata", priceCents: 3000 },
    ],
    modes: { table: false, pickup: true, delivery: false },
    account: { email: newEmail(), password },
    ...overrides,
  };
}

/** Bindings con una cola falsa para inspeccionar lo que se encola; `failing`: la cola rechaza. */
function withJobs(options: { failing?: boolean } = {}) {
  const sent: JobMessage[] = [];
  const JOBS = {
    send: (message: JobMessage) => {
      if (options.failing) return Promise.reject(new Error("queue unavailable"));
      sent.push(message);
      return Promise.resolve();
    },
    sendBatch: () => Promise.resolve(),
  } as unknown as Queue<JobMessage>;
  return { bindings: getEnv({ ...env, JOBS }), sent };
}

function onboard(
  body: unknown,
  options: {
    key?: string | null;
    cookie?: string;
    turnstile?: string | null;
    ip?: string;
    jobs?: ReturnType<typeof withJobs>;
  } = {},
) {
  const headers = new Headers();
  const key = options.key === undefined ? crypto.randomUUID() : options.key;
  if (key !== null) headers.set("idempotency-key", key);
  const turnstile = options.turnstile === undefined ? crypto.randomUUID() : options.turnstile;
  if (turnstile !== null) headers.set("x-turnstile-token", turnstile);
  if (options.ip) headers.set("x-client-ip", options.ip);
  return Promise.resolve(
    callApi("POST", "/v1/onboarding", {
      body,
      headers,
      cookie: options.cookie,
      bindings: options.jobs?.bindings,
      // Con cola falsa, espera lo encolado con `waitUntil` para poder inspeccionarlo.
      settle: options.jobs !== undefined,
    }),
  );
}

function manyProducts(count: number) {
  return Array.from({ length: count }, (_, i) => ({ name: `Producto ${i + 1}`, priceCents: 100 }));
}

function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

async function userByEmail(email: string) {
  return db().select({ id: users.id }).from(users).where(eq(users.email, email)).get();
}

async function orgsOf(userId: string) {
  return db()
    .select({ orgId: organizationMembers.organizationId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));
}

const randomIp = () => `2001:db8:1::${crypto.randomUUID().slice(0, 4)}`;

// Aviso al correo que ya tiene cuenta (T20c).
const HOUR_MS = 60 * 60 * 1000;
const ACCOUNT_EXISTS_MESSAGE = "Ya tienes una cuenta con este correo. Entra para publicar tu menú.";

const notices = (jobs: ReturnType<typeof withJobs>) =>
  jobs.sent.filter((job) => job.template === "account-exists");

function captureLogs() {
  const lines: string[] = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  }
  return lines;
}

async function expectAccountExists(response: Response) {
  const error = await expectError(response, 409, "CONFLICT");
  // El mismo cuerpo que en T20: nada indica si el aviso salió.
  expect(error).toEqual({
    code: "CONFLICT",
    message: ACCOUNT_EXISTS_MESSAGE,
    requestId: error.requestId,
  });
}

const bodyFor = (email: string) => onboardingBody({ account: { email, password } });

describe("POST /v1/onboarding", () => {
  it("una petición crea cuenta, organización, sucursal y menú publicado con sus productos", async () => {
    const jobs = withJobs();
    const body = onboardingBody({
      modes: { table: true, pickup: true, delivery: false },
      tableCount: 8,
      alertWhatsapp: "+525500000000",
    });
    const response = await onboard(body, { jobs });
    expect(response.status).toBe(201);
    const dto = OnboardingDto.parse(await response.json());
    expect(dto.menuSlug).toMatch(/^tacos-el-guero(?:-\d+)?$/);
    expect(dto.menuUrl).toBe(`${env.WEB_ORIGIN}/m/${dto.menuSlug}`);
    const cookie = sessionCookie(response);
    expect(cookie).not.toBe("");

    // La sesión abierta es del dueño y ya ve su organización.
    const me = MeDto.parse(await (await callApi("GET", "/v1/me", { cookie })).json());
    expect(me.user.emailVerified).toBe(false);
    expect(me.user.name).toBe("Tacos El Güero");
    expect(me.memberships).toEqual([
      { orgId: dto.orgId, orgName: "Tacos El Güero", role: "owner" },
    ]);

    // Better Auth encola `verify-email` en el alta (después de responder).
    await vi.waitFor(() => expect(jobs.sent.map((job) => job.type)).toEqual(["email.send"]));
    expect(jobs.sent[0]).toMatchObject({ template: "verify-email", to: body.account.email });

    const branch = await db().select().from(branches).where(eq(branches.id, dto.branchId)).get();
    expect(branch).toMatchObject({
      organizationId: dto.orgId,
      name: "Tacos El Güero",
      modeTable: true,
      modePickup: true,
      modeDelivery: false,
      tableCount: 8,
      alertWhatsapp: "+525500000000",
    });
    expect(branch?.alertOptInAt).toBeInstanceOf(Date);
    const menu = await db().select().from(menus).where(eq(menus.branchId, dto.branchId)).get();
    expect(menu).toMatchObject({ slug: dto.menuSlug, status: "published" });
    expect(menu?.publishedAt).toBeInstanceOf(Date);
    const [category] = await db()
      .select()
      .from(categories)
      .where(eq(categories.menuId, menu?.id ?? ""));
    expect(category?.name).toBe("Menú");
    const theme = await db()
      .select()
      .from(storefrontThemes)
      .where(eq(storefrontThemes.menuId, menu?.id ?? ""))
      .get();
    expect(theme?.preset).toBe("minimal");

    const publicMenu = await callApi("GET", `/v1/public/menus/${dto.menuSlug}`);
    expect(publicMenu.status).toBe(200);
    const menuDto = PublicMenuDto.parse(await publicMenu.json());
    expect(menuDto.business.name).toBe("Tacos El Güero");
    expect(menuDto.categories).toHaveLength(1);
    expect(
      menuDto.categories[0]?.products.map(({ name, priceCents }) => ({ name, priceCents })),
    ).toEqual(body.products);
    // Correo sin verificar: el menú se ve pero no recibe pedidos (ADR-008).
    expect(menuDto.acceptingOrders).toBe(false);
    expect(menuDto.notAcceptingReason).toBe("unverified");
  });

  it("deja la suscripción pro en trialing con fin de periodo a 90 días del alta", async () => {
    const before = Date.now();
    const response = await onboard(onboardingBody());
    expect(response.status).toBe(201);
    const { orgId } = OnboardingDto.parse(await response.json());
    const cookie = sessionCookie(response);

    const subscription = await callApi("GET", `/v1/orgs/${orgId}/subscription`, { cookie });
    expect(subscription.status).toBe(200);
    const dto = SubscriptionDto.parse(await subscription.json());
    expect(dto.plan.id).toBe("pro");
    expect(dto.status).toBe("trialing");
    const periodEnd = new Date(dto.currentPeriodEnd ?? 0).getTime();
    expect(periodEnd).toBeGreaterThanOrEqual(before + TRIAL_DAYS * DAY_MS);
    expect(periodEnd).toBeLessThanOrEqual(Date.now() + TRIAL_DAYS * DAY_MS);
    expect(dto.usage).toMatchObject({ branches: 1, products: 2, members: 1 });
  });

  it("dos negocios con el mismo nombre reciben slugs distintos", async () => {
    const businessName = `Fonda Doña Lupe ${crypto.randomUUID().slice(0, 8)}`;
    const first = OnboardingDto.parse(
      await (await onboard(onboardingBody({ businessName }))).json(),
    );
    const second = OnboardingDto.parse(
      await (await onboard(onboardingBody({ businessName }))).json(),
    );
    expect(second.menuSlug).toBe(`${first.menuSlug}-2`);
  });

  describe("idempotencia", () => {
    it("misma llave y mismo cuerpo dos veces → una sola organización y la misma respuesta", async () => {
      const key = crypto.randomUUID();
      const body = onboardingBody();
      const first = await onboard(body, { key });
      expect(first.status).toBe(201);
      const firstDto = OnboardingDto.parse(await first.json());
      const cookie = sessionCookie(first);

      const second = await onboard(body, { key, cookie });
      expect(second.status).toBe(201);
      expect(OnboardingDto.parse(await second.json())).toEqual(firstDto);

      const user = await userByEmail(body.account.email);
      expect(await orgsOf(user?.id ?? "")).toEqual([{ orgId: firstDto.orgId, role: "owner" }]);
      const stored = await db()
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, key))
        .get();
      expect(stored).toMatchObject({ organizationId: firstDto.orgId, scope: "onboarding" });
      // El hash no guarda la contraseña ni el cuerpo en claro.
      expect(stored?.requestHash).toMatch(/^[\da-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(password);
    });

    it("misma llave con otro cuerpo → 409 IDEMPOTENCY_CONFLICT sin crear nada", async () => {
      const key = crypto.randomUUID();
      const body = onboardingBody();
      const first = await onboard(body, { key });
      expect(first.status).toBe(201);
      const cookie = sessionCookie(first);

      // Con la sesión del dueño y otro nombre de negocio.
      await expectError(
        await onboard({ ...body, businessName: "Otro negocio" }, { key, cookie }),
        409,
        "IDEMPOTENCY_CONFLICT",
      );
      // Sin sesión y con otro correo: no se crea la cuenta.
      const otherEmail = newEmail();
      await expectError(
        await onboard({ ...body, account: { email: otherEmail, password } }, { key }),
        409,
        "IDEMPOTENCY_CONFLICT",
      );
      expect(await userByEmail(otherEmail)).toBeUndefined();
    });

    it("misma llave y mismo cuerpo sin sesión → 409 CONFLICT (la cuenta ya existe)", async () => {
      const key = crypto.randomUUID();
      const body = onboardingBody();
      expect((await onboard(body, { key })).status).toBe(201);
      const error = await expectError(await onboard(body, { key }), 409, "CONFLICT");
      expect(error.message).toBe(
        "Ya tienes una cuenta con este correo. Entra para publicar tu menú.",
      );
    });

    it("falla del batch → usuario con sesión y sin org; el reintento con sesión completa el alta", async () => {
      const key = crypto.randomUUID();
      const body = onboardingBody();
      // Falla real de D1 dentro del batch: un trigger aborta la inserción de la organización.
      await env.DB.prepare(
        "CREATE TRIGGER onboarding_falla BEFORE INSERT ON organizations BEGIN SELECT RAISE(ABORT, 'falla simulada'); END",
      ).run();
      let failed: Response;
      try {
        failed = await onboard(body, { key });
      } finally {
        await env.DB.prepare("DROP TRIGGER onboarding_falla").run();
      }
      await expectError(failed, 500, "INTERNAL");
      const cookie = sessionCookie(failed);
      expect(cookie).not.toBe("");
      const user = await userByEmail(body.account.email);
      expect(user).toBeDefined();
      expect(await orgsOf(user?.id ?? "")).toEqual([]);
      expect(
        await db().select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).get(),
      ).toBeUndefined();

      const retry = await onboard(body, { key, cookie });
      expect(retry.status).toBe(201);
      const dto = OnboardingDto.parse(await retry.json());
      expect(await orgsOf(user?.id ?? "")).toEqual([{ orgId: dto.orgId, role: "owner" }]);
      expect((await callApi("GET", `/v1/public/menus/${dto.menuSlug}`)).status).toBe(200);
    });
  });

  describe("con sesión", () => {
    it("usuario que ya tiene organización → 409 CONFLICT", async () => {
      const user = await createUser();
      await createOrg({ ownerId: user.id });
      const error = await expectError(
        await onboard(onboardingBody({ account: { email: user.email, password } }), {
          cookie: user.cookie,
        }),
        409,
        "CONFLICT",
      );
      expect(error.message).toBe(
        "Tu cuenta ya tiene un negocio. Entra a tu panel para editar tu menú.",
      );
    });

    it("correo distinto al de la sesión → 409 CONFLICT", async () => {
      const user = await createUser();
      await expectError(await onboard(onboardingBody(), { cookie: user.cookie }), 409, "CONFLICT");
      expect(await orgsOf(user.id)).toEqual([]);
    });

    it("usuario sin organización reanuda el alta sin crear otra cuenta", async () => {
      const user = await createUser({ emailVerified: false });
      const response = await onboard(onboardingBody({ account: { email: user.email, password } }), {
        cookie: user.cookie,
      });
      expect(response.status).toBe(201);
      const dto = OnboardingDto.parse(await response.json());
      expect(await orgsOf(user.id)).toEqual([{ orgId: dto.orgId, role: "owner" }]);
    });
  });

  describe("rechazos antes de crear el usuario", () => {
    it.each([
      ["correo desechable", "mailinator.com"],
      ["dominio sin MX", NO_MAIL_DOMAIN],
    ])("%s → 400", async (_case, domain) => {
      const email = newEmail(domain);
      await expectError(
        await onboard(onboardingBody({ account: { email, password } })),
        400,
        "VALIDATION_FAILED",
      );
      expect(await userByEmail(email)).toBeUndefined();
    });

    it.each([
      ["sin token", null],
      ["token inválido", "2x0000000000000000000000000000000AA"],
    ])("Turnstile %s → 400", async (_case, turnstile) => {
      const body = onboardingBody();
      const error = await expectError(await onboard(body, { turnstile }), 400, "VALIDATION_FAILED");
      expect(error.fieldErrors).toHaveProperty("turnstileToken");
      expect(await userByEmail(body.account.email)).toBeUndefined();
    });

    it("Turnstile reutilizado → 400", async () => {
      const turnstile = crypto.randomUUID();
      expect((await onboard(onboardingBody(), { turnstile })).status).toBe(201);
      const body = onboardingBody();
      await expectError(await onboard(body, { turnstile }), 400, "VALIDATION_FAILED");
      expect(await userByEmail(body.account.email)).toBeUndefined();
    });

    it("correo ya registrado → 409 CONFLICT", async () => {
      const user = await createUser();
      const error = await expectError(
        await onboard(onboardingBody({ account: { email: user.email, password } })),
        409,
        "CONFLICT",
      );
      expect(error.message).toBe(
        "Ya tienes una cuenta con este correo. Entra para publicar tu menú.",
      );
      expect(await orgsOf(user.id)).toEqual([]);
    });

    it("cuarta alta del día desde la misma IP → 429 con Retry-After", async () => {
      const ip = randomIp();
      const allowed = await Promise.all(
        [1, 2, 3].map(() => onboard(onboardingBody(), { ip }).then((response) => response.status)),
      );
      expect(allowed).toEqual([201, 201, 201]);
      const body = onboardingBody();
      const response = await onboard(body, { ip });
      await expectError(response, 429, "RATE_LIMITED");
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await userByEmail(body.account.email)).toBeUndefined();
    });

    it.each([
      ["sin Idempotency-Key", null],
      ["Idempotency-Key con formato inválido", "no-es-uuid"],
    ])("%s → 400", async (_case, key) => {
      const body = onboardingBody();
      const error = await expectError(await onboard(body, { key }), 400, "VALIDATION_FAILED");
      expect(error.fieldErrors).toHaveProperty("idempotency-key");
      expect(await userByEmail(body.account.email)).toBeUndefined();
    });

    it.each([
      ["mesa sin número de mesas", { table: true, pickup: false, delivery: false }, "tableCount"],
      ["sin modalidades", { table: false, pickup: false, delivery: false }, "modes"],
    ])("%s → 400", async (_case, modes, field) => {
      const body = onboardingBody({ modes });
      const error = await expectError(await onboard(body), 400, "VALIDATION_FAILED");
      expect(error.fieldErrors).toHaveProperty(field);
      expect(await userByEmail(body.account.email)).toBeUndefined();
    });

    it("más productos que max_products del plan free → 400", async () => {
      const free = await db()
        .select({ maxProducts: plans.maxProducts })
        .from(plans)
        .where(eq(plans.id, "free"))
        .get();
      const max = free?.maxProducts ?? 0;

      const body = onboardingBody({ products: manyProducts(max + 1) });
      const error = await expectError(await onboard(body), 400, "VALIDATION_FAILED");
      expect(error.fieldErrors).toHaveProperty("products");
      expect(await userByEmail(body.account.email)).toBeUndefined();

      expect((await onboard(onboardingBody({ products: manyProducts(max) }))).status).toBe(201);
    });

    it("cuerpo con llaves desconocidas o sin productos → 400", async () => {
      await expectError(
        await onboard(onboardingBody({ organizationId: "x" })),
        400,
        "VALIDATION_FAILED",
      );
      await expectError(await onboard(onboardingBody({ products: [] })), 400, "VALIDATION_FAILED");
    });
  });

  describe("aviso al correo que ya tiene cuenta (T20c)", () => {
    it("correo ya registrado → mismo 409 y account-exists a ese correo, con enlaces sin token", async () => {
      const user = await createUser();
      const jobs = withJobs();
      const logs = captureLogs();

      await expectAccountExists(await onboard(bodyFor(user.email), { jobs }));

      expect(jobs.sent).toEqual([
        {
          type: "email.send",
          id: expect.any(String),
          to: user.email,
          template: "account-exists",
          data: {
            signInUrl: `${env.WEB_ORIGIN}/entrar`,
            resetUrl: `${env.WEB_ORIGIN}/restablecer`,
          },
        },
      ]);
      expect(logs.some((line) => line.includes('"event":"auth.existing_account_notified"'))).toBe(
        true,
      );
      expect(logs.join("\n")).not.toContain(user.email);
    });

    it("misma llave y mismo cuerpo sin sesión → mismo 409 y el mismo aviso", async () => {
      const key = crypto.randomUUID();
      const body = onboardingBody();
      const jobs = withJobs();
      expect((await onboard(body, { key, jobs })).status).toBe(201);

      await expectAccountExists(await onboard(body, { key, jobs }));

      expect(jobs.sent.map((job) => job.template)).toEqual(["verify-email", "account-exists"]);
      expect(notices(jobs)[0]?.to).toBe(body.account.email);
    });

    it("segundo intento dentro de la misma hora → 409 idéntico sin encolar", async () => {
      const user = await createUser();
      const jobs = withJobs();
      const logs = captureLogs();

      await expectAccountExists(await onboard(bodyFor(user.email), { jobs }));
      await expectAccountExists(await onboard(bodyFor(user.email), { jobs }));

      expect(notices(jobs)).toHaveLength(1);
      expect(
        logs.some(
          (line) =>
            line.includes('"event":"auth.existing_account_notice_skipped"') &&
            line.includes('"reason":"quota"'),
        ),
      ).toBe(true);
    });

    it("el cuarto intento del día no encola, aunque sea en otra hora", async () => {
      const user = await createUser();
      const jobs = withJobs();
      // Tres avisos en otras horas del mismo día UTC (ventanas fijas, ADR-010).
      const now = Date.now();
      const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
      const currentHour = Math.floor((now - dayStart) / HOUR_MS);
      const otherHours = [0, 1, 2, 3].filter((hour) => hour !== currentHour).slice(0, 3);
      const pending: Promise<unknown>[] = [];
      for (const hour of otherHours) {
        notifyExistingAccount(
          { env: jobs.bindings, requestId: "prueba", waitUntil: (task) => pending.push(task) },
          user.email,
          dayStart + hour * HOUR_MS,
        );
      }
      await Promise.all(pending);
      expect(notices(jobs)).toHaveLength(3);

      await expectAccountExists(await onboard(bodyFor(user.email), { jobs }));

      expect(notices(jobs)).toHaveLength(3);
    });

    it("cuenta con email_status undeliverable → 409 sin encolar", async () => {
      const user = await createUser();
      await db().update(users).set({ emailStatus: "undeliverable" }).where(eq(users.id, user.id));
      const jobs = withJobs();
      const logs = captureLogs();

      await expectAccountExists(await onboard(bodyFor(user.email), { jobs }));

      expect(jobs.sent).toEqual([]);
      expect(logs.some((line) => line.includes('"reason":"undeliverable"'))).toBe(true);
    });

    it("falla al encolar → sigue siendo 409 CONFLICT y se registra email.enqueue_failed", async () => {
      const user = await createUser();
      const jobs = withJobs({ failing: true });
      const logs = captureLogs();

      await expectAccountExists(await onboard(bodyFor(user.email), { jobs }));

      expect(
        logs.some(
          (line) =>
            line.includes('"event":"email.enqueue_failed"') &&
            line.includes('"template":"account-exists"'),
        ),
      ).toBe(true);
    });

    it("correo nuevo → solo se encola verify-email", async () => {
      const jobs = withJobs();

      expect((await onboard(onboardingBody(), { jobs })).status).toBe(201);

      expect(jobs.sent.map((job) => job.template)).toEqual(["verify-email"]);
    });

    it("Turnstile inválido → no se encola ningún aviso", async () => {
      const user = await createUser();
      const jobs = withJobs();

      await expectError(
        await onboard(bodyFor(user.email), {
          jobs,
          turnstile: "2x0000000000000000000000000000000AA",
        }),
        400,
        "VALIDATION_FAILED",
      );

      expect(jobs.sent).toEqual([]);
    });

    it("cuota de altas por IP excedida → no se encola ningún aviso", async () => {
      const user = await createUser();
      const ip = randomIp();
      const allowed = await Promise.all(
        [1, 2, 3].map(() => onboard(onboardingBody(), { ip }).then((response) => response.status)),
      );
      expect(allowed).toEqual([201, 201, 201]);
      const jobs = withJobs();

      await expectError(await onboard(bodyFor(user.email), { ip, jobs }), 429, "RATE_LIMITED");

      expect(jobs.sent).toEqual([]);
    });

    it("correo desechable ya registrado → no se encola ningún aviso", async () => {
      const email = newEmail("mailinator.com");
      await db().insert(users).values({ id: newId(), email, name: "Prueba", emailVerified: true });
      const jobs = withJobs();

      await expectError(await onboard(bodyFor(email), { jobs }), 400, "VALIDATION_FAILED");

      expect(jobs.sent).toEqual([]);
    });
  });
});
