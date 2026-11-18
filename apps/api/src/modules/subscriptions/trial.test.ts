import {
  CategoryDto,
  EmailSendJob,
  ErrorResponse,
  JobMessage,
  MenuPublicationDto,
  PublicMenuDto,
  SubscriptionDto,
  type SubscriptionStatus,
} from "@menu-max/contracts";
import { menus, plans, products, subscriptions, users } from "@menu-max/database";
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMember,
  createBranch,
  createOrg,
  createUser,
  type TestUser,
} from "../../../test/factories";
import { callApi } from "../../../test/isolation";
import { getEnv, type Env } from "../../env";
import { createDb } from "../../infrastructure/db";
import { renderEmail } from "../../infrastructure/mailer/templates";
import { newId } from "../../shared/ids";
import worker from "../../index";

const db = () => createDb(getEnv(env));
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// 9:00 UTC: la hora del Cron diario.
const T0 = Date.UTC(2027, 1, 1, 9);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Cola falsa que guarda los mensajes; con `fail`, cada envío falla como una cola caída. */
function fakeJobs(options: { fail?: boolean } = {}) {
  const messages: JobMessage[] = [];
  const send = vi.fn((message: JobMessage) => {
    if (options.fail) return Promise.reject(new Error("cola no disponible"));
    messages.push(JobMessage.parse(message));
    return Promise.resolve();
  });
  const sendBatch = vi.fn(() => Promise.reject(new Error("sin uso en estas pruebas")));
  return { JOBS: { send, sendBatch } as unknown as Env["JOBS"], messages };
}

function runCron(now: number, overrides: Partial<Env> = {}) {
  return worker.scheduled(createScheduledController({ scheduledTime: now, cron: "0 9 * * *" }), {
    ...getEnv(env),
    ...overrides,
  });
}

/** Organización en prueba `pro` + `trialing` que vence en `endsAt`, creada en `createdAt`. */
async function trial(options: {
  endsAt: number;
  createdAt?: number;
  status?: SubscriptionStatus;
  planId?: string;
}) {
  const owner = await createUser();
  const org = await createOrg({
    ownerId: owner.id,
    planId: options.planId ?? "pro",
    status: options.status ?? "trialing",
  });
  await db()
    .update(subscriptions)
    .set({
      currentPeriodEnd: new Date(options.endsAt),
      createdAt: new Date(options.createdAt ?? options.endsAt - 90 * DAY),
    })
    .where(eq(subscriptions.organizationId, org.orgId));
  return { owner, org };
}

async function subscriptionOf(orgId: string) {
  const [row] = await db()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, orgId));
  if (!row) throw new Error("Sin suscripción");
  return row;
}

async function freePlan() {
  const [row] = await db().select().from(plans).where(eq(plans.id, "free"));
  if (!row) throw new Error("Falta el plan free");
  return row;
}

/** Correos `email.send` encolados a estos destinatarios (la D1 la comparten otras pruebas). */
function mailsTo(messages: JobMessage[], ...people: TestUser[]) {
  const emails = new Set(people.map((person) => person.email));
  return messages.map((message) => EmailSendJob.parse(message)).filter((m) => emails.has(m.to));
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  const [item] = items;
  if (item === undefined) throw new Error("Sin elementos");
  return item;
}

describe("avisos previos al fin de la prueba", () => {
  it("a 15 días encola uno por owner entregable; correr el Cron dos veces no lo duplica", async () => {
    const { owner, org } = await trial({ endsAt: T0 + 15 * DAY - HOUR });
    const coOwner = await createUser();
    await addMember({ orgId: org.orgId, userId: coOwner.id, role: "owner" });
    const admin = await createUser();
    await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
    const bounced = await createUser();
    await addMember({ orgId: org.orgId, userId: bounced.id, role: "owner" });
    await db().update(users).set({ emailStatus: "undeliverable" }).where(eq(users.id, bounced.id));
    const logs = vi.spyOn(console, "info");

    const jobs = fakeJobs();
    await runCron(T0, jobs);

    const sent = mailsTo(jobs.messages, owner, coOwner, admin, bounced);
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((mail) => mail.to))).toEqual(new Set([owner.email, coOwner.email]));
    const free = await freePlan();
    for (const mail of sent) {
      expect(mail).toMatchObject({
        template: "trial-ending",
        data: {
          url: "http://localhost:5173/app/ajustes",
          planName: free.name,
          daysLeft: 15,
          trialEndsAt: new Date(T0 + 15 * DAY - HOUR).toISOString(),
          limits: {
            maxBranches: free.maxBranches,
            maxProducts: free.maxProducts,
            maxMembers: free.maxMembers,
          },
        },
      });
    }
    expect((await subscriptionOf(org.orgId)).trialNotice15SentAt?.getTime()).toBe(T0);
    // Logs con `orgId`, sin correos.
    const lines = logs.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("subscription.trial_notice_sent"))).toBe(true);
    expect(lines.join("\n")).not.toContain(owner.email);

    const again = fakeJobs();
    await runCron(T0 + HOUR, again);
    expect(mailsTo(again.messages, owner, coOwner)).toEqual([]);
  });

  it("a 3 días encola el de 3 aunque el de 15 nunca salió, y no lo repite", async () => {
    const { owner, org } = await trial({ endsAt: T0 + 3 * DAY - HOUR });

    const jobs = fakeJobs();
    await runCron(T0, jobs);
    const sent = mailsTo(jobs.messages, owner);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: "trial-ending", data: { daysLeft: 3 } });
    const row = await subscriptionOf(org.orgId);
    expect(row.trialNotice3SentAt?.getTime()).toBe(T0);
    expect(row.trialNotice15SentAt).toBeNull();

    const again = fakeJobs();
    await runCron(T0 + DAY, again);
    expect(mailsTo(again.messages, owner)).toEqual([]);
  });

  it("una prueba creada con menos de 15 días restantes recibe solo el aviso de 3 días", async () => {
    const { owner } = await trial({ endsAt: T0 + 10 * DAY, createdAt: T0 - HOUR });

    const runs = [T0, T0 + 3 * DAY, T0 + 7 * DAY + HOUR, T0 + 8 * DAY];
    const jobs = fakeJobs();
    for (const now of runs) {
      // Corridas de días distintos, en orden: cada una ve lo que marcó la anterior.
      // oxlint-disable-next-line no-await-in-loop -- el Cron corre un día después del otro
      await runCron(now, jobs);
    }
    const sent = mailsTo(jobs.messages, owner);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: "trial-ending", data: { daysLeft: 3 } });
  });

  it("si encolar falla, la columna sigue en null y la siguiente corrida lo envía", async () => {
    const { owner, org } = await trial({ endsAt: T0 + 15 * DAY - HOUR });

    await runCron(T0, fakeJobs({ fail: true }));
    expect((await subscriptionOf(org.orgId)).trialNotice15SentAt).toBeNull();

    const jobs = fakeJobs();
    await runCron(T0 + DAY, jobs);
    const sent = mailsTo(jobs.messages, owner);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: "trial-ending", data: { daysLeft: 14 } });
    expect((await subscriptionOf(org.orgId)).trialNotice15SentAt?.getTime()).toBe(T0 + DAY);
  });

  it.each(["active", "past_due", "suspended"] as const)(
    "una suscripción %s no recibe avisos ni cambia de plan aunque su periodo venza",
    async (status) => {
      const soon = await trial({ endsAt: T0 + 2 * DAY, status });
      const expired = await trial({ endsAt: T0 - DAY, status });

      const jobs = fakeJobs();
      await runCron(T0, jobs);

      expect(mailsTo(jobs.messages, soon.owner, expired.owner)).toEqual([]);
      for (const { org } of [soon, expired]) {
        // oxlint-disable-next-line no-await-in-loop -- dos lecturas de prueba
        expect(await subscriptionOf(org.orgId)).toMatchObject({
          planId: "pro",
          status,
          trialNotice3SentAt: null,
          trialEndedNoticePendingAt: null,
        });
      }
    },
  );
});

async function menuVersion(branchId: string) {
  const [row] = await db()
    .select({ menuVersion: menus.menuVersion })
    .from(menus)
    .where(eq(menus.branchId, branchId));
  return row?.menuVersion;
}

describe("paso automático a free", () => {
  it("vencida: queda free + active sin current_period_end, encola trial-ended y una segunda corrida no cambia nada", async () => {
    const { owner, org } = await trial({ endsAt: T0 - HOUR });
    const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
    // Leer el menú lo crea (T16).
    const read = await callApi("GET", `/v1/orgs/${org.orgId}/branches/${branchId}/menu`, {
      cookie: owner.cookie,
    });
    expect(read.status).toBe(200);
    const before = await menuVersion(branchId);

    const jobs = fakeJobs();
    await runCron(T0, jobs);

    const row = await subscriptionOf(org.orgId);
    expect(row).toMatchObject({
      planId: "free",
      status: "active",
      currentPeriodEnd: null,
      trialEndedNoticePendingAt: null,
    });
    const sent = mailsTo(jobs.messages, owner);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      template: "trial-ended",
      data: { planName: (await freePlan()).name, usage: { branches: 1, members: 1 } },
    });
    // El tema público depende del plan: la caché de WEB se refresca (ADR-014).
    expect(await menuVersion(branchId)).toBe((before ?? 0) + 1);

    const again = fakeJobs();
    await runCron(T0 + DAY, again);
    expect(mailsTo(again.messages, owner)).toEqual([]);
    expect(await subscriptionOf(org.orgId)).toMatchObject({ planId: "free", status: "active" });
    expect(await menuVersion(branchId)).toBe((before ?? 0) + 1);
  });

  it("si encolar falla tras el cambio, la cuenta ya es free y el aviso se envía en la siguiente corrida sin volver a cambiar el plan", async () => {
    const { owner, org } = await trial({ endsAt: T0 - HOUR });
    const branchId = await createBranch({ orgId: org.orgId, businessId: org.businessId });
    await callApi("GET", `/v1/orgs/${org.orgId}/branches/${branchId}/menu`, {
      cookie: owner.cookie,
    });

    await runCron(T0, fakeJobs({ fail: true }));
    const changed = await subscriptionOf(org.orgId);
    expect(changed).toMatchObject({ planId: "free", status: "active", currentPeriodEnd: null });
    expect(changed.trialEndedNoticePendingAt?.getTime()).toBe(T0);
    const version = await menuVersion(branchId);

    const jobs = fakeJobs();
    await runCron(T0 + DAY, jobs);
    expect(mailsTo(jobs.messages, owner).map((mail) => mail.template)).toEqual(["trial-ended"]);
    expect((await subscriptionOf(org.orgId)).trialEndedNoticePendingAt).toBeNull();
    // No hubo un segundo cambio de plan: `menu_version` no volvió a subir.
    expect(await menuVersion(branchId)).toBe(version);
  });

  it("con 3 sucursales y 80 productos todo sigue operando y solo se bloquean nuevas altas", async () => {
    const { owner, org } = await trial({ endsAt: T0 - HOUR });
    const branchIds = await Promise.all(
      [1, 2, 3].map((n) =>
        createBranch({ orgId: org.orgId, businessId: org.businessId, name: `Sucursal ${n}` }),
      ),
    );
    const base = `/v1/orgs/${org.orgId}`;
    const menu = `${base}/branches/${branchIds[0]}/menu`;
    const category = await callApi("POST", `${menu}/categories`, {
      cookie: owner.cookie,
      body: { name: "Tacos" },
    });
    expect(category.status).toBe(201);
    const { id: categoryId } = CategoryDto.parse(await category.json());
    const [menuRow] = await db()
      .select()
      .from(menus)
      .where(eq(menus.branchId, branchIds[0] ?? ""));
    const rows = Array.from({ length: 80 }, (_, position) => ({
      id: newId(),
      organizationId: org.orgId,
      menuId: menuRow?.id ?? "",
      categoryId,
      name: `Producto ${position}`,
      priceCents: 1_000,
      position,
    }));
    // De 5 en 5: D1 admite 100 parámetros por sentencia.
    const database = db();
    const [first, ...rest] = Array.from({ length: rows.length / 5 }, (_, i) =>
      database.insert(products).values(rows.slice(i * 5, i * 5 + 5)),
    );
    if (first) await database.batch([first, ...rest]);
    const hours = await callApi("PUT", `${base}/branches/${branchIds[0]}/hours`, {
      cookie: owner.cookie,
      body: {
        ranges: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          opensAt: "00:00",
          closesAt: "24:00",
        })),
      },
    });
    expect(hours.status).toBe(200);
    const publication = await callApi("POST", `${menu}/publish`, { cookie: owner.cookie });
    expect(publication.status).toBe(200);
    const slug = MenuPublicationDto.parse(await publication.json()).slug ?? "";
    const readPublic = async () => {
      const response = await callApi("GET", `/v1/public/menus/${slug}`);
      expect(response.status).toBe(200);
      return PublicMenuDto.parse(await response.json());
    };
    const publicBefore = await readPublic();

    const jobs = fakeJobs();
    await runCron(T0, jobs);

    const subscription = await callApi("GET", `${base}/subscription`, { cookie: owner.cookie });
    expect(SubscriptionDto.parse(await subscription.json())).toMatchObject({
      plan: { id: "free" },
      usage: { branches: 3, products: 80 },
    });
    // El correo avisa que conserva sucursales y productos.
    const { text } = renderEmail(only(mailsTo(jobs.messages, owner)));
    expect(text).toContain("Conservas tus sucursales actuales. Para agregar otra necesitas Pro.");
    expect(text).toContain("Conservas tus productos actuales. Para agregar otro necesitas Pro.");

    // Nada se oculta: el menú público sigue con todos sus productos y el mismo estado de pedidos.
    const publicAfter = await readPublic();
    expect(publicAfter.acceptingOrders).toBe(publicBefore.acceptingOrders);
    expect(publicAfter.categories.flatMap((c) => c.products)).toHaveLength(80);
    for (const branchId of branchIds) {
      // oxlint-disable-next-line no-await-in-loop -- tres lecturas de prueba
      const response = await callApi("GET", `${base}/branches/${branchId}/menu`, {
        cookie: owner.cookie,
      });
      expect(response.status).toBe(200);
    }

    const newBranch = await callApi("POST", `${base}/branches`, {
      cookie: owner.cookie,
      body: { name: "Norte", modes: { table: false, pickup: true, delivery: false } },
    });
    expect(newBranch.status).toBe(402);
    expect(ErrorResponse.parse(await newBranch.json()).code).toBe("PLAN_LIMIT_REACHED");
    const newProduct = await callApi("POST", `${menu}/products`, {
      cookie: owner.cookie,
      body: { categoryId, name: "Taco de suadero", priceCents: 2_500 },
    });
    expect(newProduct.status).toBe(402);
    expect(ErrorResponse.parse(await newProduct.json()).code).toBe("PLAN_LIMIT_REACHED");
  });

  it("los correos llevan los límites de la fila de plans, no valores escritos a mano", async () => {
    const free = await freePlan();
    await db()
      .update(plans)
      .set({ name: "Básico", maxProducts: 77, removeBranding: true })
      .where(eq(plans.id, "free"));
    try {
      const { owner } = await trial({ endsAt: T0 - HOUR });
      const jobs = fakeJobs();
      await runCron(T0, jobs);

      const mail = only(mailsTo(jobs.messages, owner));
      expect(mail).toMatchObject({
        data: {
          planName: "Básico",
          limits: { maxProducts: 77 },
          features: { removeBranding: true },
        },
      });
      const { subject, text } = renderEmail(mail);
      expect(subject).toContain("plan Básico");
      expect(text).toContain("77 productos");
      expect(text).not.toContain("sello de MenusMax");
    } finally {
      await db()
        .update(plans)
        .set({
          name: free.name,
          maxProducts: free.maxProducts,
          removeBranding: free.removeBranding,
        })
        .where(eq(plans.id, "free"));
    }
  });
});

describe("Cron diario", () => {
  it("una tarea que falla no detiene a las demás, y la corrida falla al final", async () => {
    const { owner, org } = await trial({ endsAt: T0 - HOUR });
    const real = getEnv(env).DB;
    // D1 que falla solo en la limpieza de `rate_counters`.
    const failingDb = new Proxy(real, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            if (query.includes("rate_counters")) throw new Error("D1 no disponible");
            return target.prepare(query);
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const errors = vi.spyOn(console, "error");

    const jobs = fakeJobs();
    await expect(runCron(T0, { ...jobs, DB: failingDb })).rejects.toThrow("rateCounters");

    expect(await subscriptionOf(org.orgId)).toMatchObject({ planId: "free", status: "active" });
    expect(mailsTo(jobs.messages, owner).map((mail) => mail.template)).toEqual(["trial-ended"]);
    expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      '"task":"rateCounters"',
    );
  });
});
