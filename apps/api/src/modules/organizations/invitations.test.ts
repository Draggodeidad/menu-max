import {
  AcceptInvitationDto,
  ErrorResponse,
  InvitationDto,
  InvitationListDto,
  InvitationPreviewDto,
  type JobMessage,
} from "@menu-max/contracts";
import { invitations, memberBranches, organizationMembers, users } from "@menu-max/database";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMember, createBranch, createOrg, createUser } from "../../../test/factories";
import { callApi, expectNotFoundForOtherTenant } from "../../../test/isolation";
import { getEnv, type Env } from "../../env";
import { createDb } from "../../infrastructure/db";
import { hashToken, newId } from "../../shared/ids";
import { emailVerifiedStatement } from "../auth/auth.service";
import { claimInvitationStatements, invitationClaimed } from "./organizations.repository";
import { hit } from "../../shared/rate-counters";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE = "x-turnstile-token";
const password = "Contraseña de prueba 4817";

beforeEach(() => {
  const usedTurnstile = new Set<string>();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === SITEVERIFY) {
      // Imita siteverify con la clave de prueba que siempre pasa, salvo tokens reutilizados.
      const form = init?.body;
      const token = form instanceof FormData ? String(form.get("response")) : "";
      const duplicate = usedTurnstile.has(token);
      usedTurnstile.add(token);
      return Promise.resolve(
        Response.json(
          duplicate
            ? { success: false, "error-codes": ["timeout-or-duplicate"] }
            : { success: true, "error-codes": [] },
        ),
      );
    }
    if (url.origin === "https://cloudflare-dns.com") {
      // Todo dominio de prueba tiene MX.
      return Promise.resolve(
        Response.json({ Status: 0, Answer: [{ type: 15, data: "10 mx.example.com." }] }),
      );
    }
    // haveIBeenPwned: ninguna contraseña de prueba está filtrada.
    if (url.origin === "https://api.pwnedpasswords.com") return Promise.resolve(new Response(""));
    throw new Error("Petición externa inesperada.");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const db = () => createDb(getEnv(env));

/** Bindings con una cola falsa para inspeccionar lo que se encola. */
function withJobs() {
  const sent: JobMessage[] = [];
  const JOBS = {
    send: (message: JobMessage) => {
      sent.push(message);
      return Promise.resolve();
    },
    sendBatch: () => Promise.resolve(),
  } as unknown as Queue<JobMessage>;
  return { bindings: getEnv({ ...env, JOBS }), sent };
}

async function expectError(response: Response, status: number, code: ErrorResponse["code"]) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.code).toBe(code);
  return body;
}

async function scenario() {
  const owner = await createUser();
  const org = await createOrg({ ownerId: owner.id, name: "Tacos El Güero" });
  const branchA = await createBranch({ orgId: org.orgId, businessId: org.businessId });
  const admin = await createUser();
  await addMember({ orgId: org.orgId, userId: admin.id, role: "admin" });
  const staff = await createUser();
  await addMember({ orgId: org.orgId, userId: staff.id, role: "staff", branchIds: [branchA] });
  const path = `/v1/orgs/${org.orgId}/invitations`;
  return { owner, org, branchA, admin, staff, path };
}

const newEmail = () => `invitada-${crypto.randomUUID()}@example.com`;

/** Invita por la API y devuelve la respuesta, el token del correo encolado y la cola. */
async function invite(
  as: { cookie: string },
  orgPath: string,
  body: Record<string, unknown>,
  jobs = withJobs(),
) {
  const response = await callApi("POST", orgPath, {
    cookie: as.cookie,
    body,
    bindings: jobs.bindings,
  });
  const job = jobs.sent.at(-1);
  const url = job?.template === "invitation" ? new URL(job.data.url) : undefined;
  return { response, token: url?.searchParams.get("token") ?? "", url, jobs };
}

async function inviteStaff(s: Awaited<ReturnType<typeof scenario>>, email = newEmail()) {
  const result = await invite(s.owner, s.path, { email, role: "staff", branchIds: [s.branchA] });
  expect(result.response.status).toBe(201);
  const invitation = InvitationDto.parse(await result.response.json());
  return { ...result, invitation, email };
}

function accept(
  token: string,
  options: { cookie?: string; body?: unknown; turnstile?: string | null; bindings?: Env } = {},
) {
  const turnstile = options.turnstile === undefined ? crypto.randomUUID() : options.turnstile;
  return callApi("POST", `/v1/public/invitations/${token}/accept`, {
    cookie: options.cookie,
    body: options.body,
    headers: turnstile ? { [TURNSTILE]: turnstile } : {},
    bindings: options.bindings,
  });
}

function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

describe("POST /v1/orgs/:orgId/invitations", () => {
  it("el dueño invita a un staff: encola el correo y guarda solo el hash del token", async () => {
    const s = await scenario();
    const email = newEmail();
    const { invitation, token, url, jobs } = await inviteStaff(s, email);
    expect(invitation).toMatchObject({
      email,
      role: "staff",
      branchIds: [s.branchA],
      expired: false,
    });
    expect(url?.origin + (url?.pathname ?? "")).toBe("http://localhost:5173/invitacion");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(jobs.sent).toEqual([
      {
        type: "email.send",
        id: expect.any(String),
        to: email,
        template: "invitation",
        data: { url: url?.href, organizationName: "Tacos El Güero", inviterName: "Prueba" },
      },
    ]);
    const row = await db()
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id))
      .get();
    expect(row?.tokenHash).toBe(await hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const days = ((row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)) / 86_400_000;
    expect(days).toBe(7);
  });

  it("normaliza el correo invitado", async () => {
    const s = await scenario();
    const email = newEmail();
    const { response } = await invite(s.owner, s.path, {
      email: `  ${email.toUpperCase()} `.trim(),
      role: "admin",
    });
    expect(InvitationDto.parse(await response.json()).email).toBe(email);
  });

  it("un admin invita staff, pero no admin ni dueño", async () => {
    const s = await scenario();
    const ok = await invite(s.admin, s.path, {
      email: newEmail(),
      role: "staff",
      branchIds: [s.branchA],
    });
    expect(ok.response.status).toBe(201);
    await Promise.all(
      ["admin", "owner"].map(async (role) => {
        const { response, jobs } = await invite(s.admin, s.path, { email: newEmail(), role });
        await expectError(response, 403, "FORBIDDEN");
        expect(jobs.sent).toEqual([]);
      }),
    );
  });

  it("un staff no invita (403)", async () => {
    const s = await scenario();
    const { response } = await invite(s.staff, s.path, {
      email: newEmail(),
      role: "staff",
      branchIds: [s.branchA],
    });
    await expectError(response, 403, "FORBIDDEN");
  });

  it("un usuario sin verificar no invita", async () => {
    const owner = await createUser({ emailVerified: false });
    const org = await createOrg({ ownerId: owner.id });
    const { response, jobs } = await invite(owner, `/v1/orgs/${org.orgId}/invitations`, {
      email: newEmail(),
      role: "admin",
    });
    await expectError(response, 403, "EMAIL_NOT_VERIFIED");
    expect(jobs.sent).toEqual([]);
  });

  it("rechaza sucursales de otra organización, staff sin sucursales y sucursales para admin", async () => {
    const s = await scenario();
    const other = await scenario();
    const bodies = [
      { email: newEmail(), role: "staff", branchIds: [other.branchA] },
      { email: newEmail(), role: "staff" },
      { email: newEmail(), role: "admin", branchIds: [s.branchA] },
    ];
    await Promise.all(
      bodies.map(async (body) => {
        const { response, jobs } = await invite(s.owner, s.path, body);
        const error = await expectError(response, 400, "VALIDATION_FAILED");
        expect(error.fieldErrors).toHaveProperty("branchIds");
        expect(jobs.sent).toEqual([]);
      }),
    );
  });

  it("rechaza correos desechables", async () => {
    const s = await scenario();
    const { response } = await invite(s.owner, s.path, {
      email: "alguien@mailinator.com",
      role: "admin",
    });
    const error = await expectError(response, 400, "VALIDATION_FAILED");
    expect(error.fieldErrors).toHaveProperty("email");
  });

  it("responde 409 si la persona ya es miembro activo", async () => {
    const s = await scenario();
    const { response } = await invite(s.owner, s.path, { email: s.admin.email, role: "admin" });
    await expectError(response, 409, "CONFLICT");
  });

  it("invitar de nuevo al mismo correo revoca la invitación anterior", async () => {
    const s = await scenario();
    const email = newEmail();
    const first = await inviteStaff(s, email);
    const second = await inviteStaff(s, email);
    const list = InvitationListDto.parse(
      await (await callApi("GET", s.path, { cookie: s.owner.cookie })).json(),
    );
    expect(list.items.map((i) => i.id)).toEqual([second.invitation.id]);
    await expectError(
      await callApi("GET", `/v1/public/invitations/${first.token}`),
      404,
      "NOT_FOUND",
    );
  });

  it("aplica la cuota de 20 invitaciones por día por organización", async () => {
    const s = await scenario();
    await Promise.all(
      Array.from({ length: 20 }, () => hit(db(), `invitations:${s.org.orgId}`, 86_400_000, 20)),
    );
    const { response, jobs } = await invite(s.owner, s.path, { email: newEmail(), role: "admin" });
    await expectError(response, 429, "RATE_LIMITED");
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(jobs.sent).toEqual([]);
  });

  it("responde 401 sin sesión", async () => {
    const s = await scenario();
    await expectError(
      await callApi("POST", s.path, { body: { email: newEmail(), role: "admin" } }),
      401,
      "AUTH_REQUIRED",
    );
  });

  it("responde 404 al dueño de otra organización", async () => {
    const s = await scenario();
    const other = await scenario();
    await expectNotFoundForOtherTenant({
      method: "POST",
      paths: [s.path],
      body: { email: newEmail(), role: "staff", branchIds: [s.branchA] },
      intruder: other.owner,
    });
  });
});

describe("GET /v1/orgs/:orgId/invitations", () => {
  it("lista las pendientes de la más nueva a la más vieja, con las vencidas marcadas", async () => {
    const s = await scenario();
    const older = await inviteStaff(s);
    const newer = await inviteStaff(s);
    const accepted = await inviteStaff(s);
    await db()
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, older.invitation.id));
    await db()
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, accepted.invitation.id));
    const response = await callApi("GET", s.path, { cookie: s.admin.cookie });
    expect(response.status).toBe(200);
    const list = InvitationListDto.parse(await response.json());
    const expected: [string, boolean][] = [
      [older.invitation.id, true],
      [newer.invitation.id, false],
    ];
    expected.sort((a, b) => b[0].localeCompare(a[0]));
    expect(list.items.map((i) => [i.id, i.expired])).toEqual(expected);
  });

  it("responde 403 a un staff", async () => {
    const s = await scenario();
    await expectError(await callApi("GET", s.path, { cookie: s.staff.cookie }), 403, "FORBIDDEN");
  });

  it("responde 401 sin sesión", async () => {
    const s = await scenario();
    await expectError(await callApi("GET", s.path), 401, "AUTH_REQUIRED");
  });

  it("responde 404 al dueño de otra organización", async () => {
    const s = await scenario();
    const other = await scenario();
    await expectNotFoundForOtherTenant({ paths: [s.path], intruder: other.owner });
  });
});

describe("DELETE /v1/orgs/:orgId/invitations/:invitationId", () => {
  it("revoca una invitación: el enlace deja de funcionar", async () => {
    const s = await scenario();
    const { invitation, token } = await inviteStaff(s);
    const response = await callApi("DELETE", `${s.path}/${invitation.id}`, {
      cookie: s.admin.cookie,
    });
    expect(response.status).toBe(204);
    await expectError(await callApi("GET", `/v1/public/invitations/${token}`), 404, "NOT_FOUND");
    await expectError(
      await callApi("DELETE", `${s.path}/${invitation.id}`, { cookie: s.admin.cookie }),
      404,
      "NOT_FOUND",
    );
  });

  it("un admin no revoca la invitación de un admin; un staff no revoca nada", async () => {
    const s = await scenario();
    const { response } = await invite(s.owner, s.path, { email: newEmail(), role: "admin" });
    const adminInvitation = InvitationDto.parse(await response.json());
    await expectError(
      await callApi("DELETE", `${s.path}/${adminInvitation.id}`, { cookie: s.admin.cookie }),
      403,
      "FORBIDDEN",
    );
    await expectError(
      await callApi("DELETE", `${s.path}/${adminInvitation.id}`, { cookie: s.staff.cookie }),
      403,
      "FORBIDDEN",
    );
  });

  it("responde 401 sin sesión", async () => {
    const s = await scenario();
    const { invitation } = await inviteStaff(s);
    await expectError(await callApi("DELETE", `${s.path}/${invitation.id}`), 401, "AUTH_REQUIRED");
  });

  it("responde 404 entre organizaciones con ids reales", async () => {
    const s = await scenario();
    const other = await scenario();
    const { invitation, token } = await inviteStaff(s);
    await expectNotFoundForOtherTenant({
      method: "DELETE",
      intruder: other.owner,
      paths: [`${s.path}/${invitation.id}`, `${other.path}/${invitation.id}`],
    });
    const preview = await callApi("GET", `/v1/public/invitations/${token}`);
    expect(preview.status).toBe(200);
  });
});

describe("GET /v1/public/invitations/:token", () => {
  it("muestra organización, rol y correo enmascarado, y si el correo ya tiene cuenta", async () => {
    const s = await scenario();
    const { token } = await inviteStaff(s);
    const response = await callApi("GET", `/v1/public/invitations/${token}`);
    expect(response.status).toBe(200);
    expect(InvitationPreviewDto.parse(await response.json())).toEqual({
      orgName: "Tacos El Güero",
      role: "staff",
      emailMasked: "i***@example.com",
      expired: false,
      accountExists: false,
    });
    const existing = await createUser();
    const second = await inviteStaff(s, existing.email);
    const preview = InvitationPreviewDto.parse(
      await (await callApi("GET", `/v1/public/invitations/${second.token}`)).json(),
    );
    expect(preview.accountExists).toBe(true);
  });

  it("marca la invitación vencida", async () => {
    const s = await scenario();
    const { invitation, token } = await inviteStaff(s);
    await db()
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, invitation.id));
    const preview = InvitationPreviewDto.parse(
      await (await callApi("GET", `/v1/public/invitations/${token}`)).json(),
    );
    expect(preview.expired).toBe(true);
  });

  it("responde 404 con un token inexistente o mal formado", async () => {
    await Promise.all(
      ["a".repeat(43), "corto"].map(async (token) =>
        expectError(await callApi("GET", `/v1/public/invitations/${token}`), 404, "NOT_FOUND"),
      ),
    );
  });
});

describe("POST /v1/public/invitations/:token/accept", () => {
  it("sin cuenta: crea el usuario verificado, la membresía y la sesión en una sola operación", async () => {
    const s = await scenario();
    const { token, email } = await inviteStaff(s);
    const jobs = withJobs();
    const response = await accept(token, {
      body: { name: "Ana López", password },
      bindings: jobs.bindings,
    });
    expect(response.status).toBe(200);
    expect(AcceptInvitationDto.parse(await response.json())).toEqual({ orgId: s.org.orgId });
    // No se envía `verify-email`: el enlace de la invitación ya probó el correo.
    expect(jobs.sent).toEqual([]);

    const user = await db().select().from(users).where(eq(users.email, email)).get();
    expect(user).toMatchObject({ name: "Ana López", emailVerified: true });
    const member = await db()
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, s.org.orgId),
          eq(organizationMembers.userId, user?.id ?? ""),
        ),
      )
      .get();
    expect(member).toMatchObject({ role: "staff", status: "active" });
    const branches = await db()
      .select({ branchId: memberBranches.branchId })
      .from(memberBranches)
      .where(eq(memberBranches.memberId, member?.id ?? ""));
    expect(branches).toEqual([{ branchId: s.branchA }]);

    // La cookie devuelta abre la organización.
    const org = await callApi("GET", `/v1/orgs/${s.org.orgId}`, {
      cookie: sessionCookie(response),
    });
    expect(org.status).toBe(200);
  });

  it("el token sirve una sola vez", async () => {
    const s = await scenario();
    const { token } = await inviteStaff(s);
    const first = await accept(token, { body: { name: "Ana", password } });
    expect(first.status).toBe(200);
    const again = await accept(token, { cookie: sessionCookie(first) });
    await expectError(again, 409, "CONFLICT");
  });

  it("sin sesión exige Turnstile válido y no reutilizado", async () => {
    const s = await scenario();
    const { token } = await inviteStaff(s);
    const missing = await expectError(
      await accept(token, { body: { name: "Ana", password }, turnstile: null }),
      400,
      "VALIDATION_FAILED",
    );
    expect(missing.fieldErrors).toHaveProperty("turnstileToken");
    const reused = crypto.randomUUID();
    await expectError(
      await accept(token, { body: { name: "Ana" }, turnstile: reused }),
      400,
      "VALIDATION_FAILED",
    );
    const replayed = await expectError(
      await accept(token, { body: { name: "Ana", password }, turnstile: reused }),
      400,
      "VALIDATION_FAILED",
    );
    expect(replayed.fieldErrors).toHaveProperty("turnstileToken");
  });

  it("sin sesión pide nombre y contraseña", async () => {
    const s = await scenario();
    const { token } = await inviteStaff(s);
    const error = await expectError(await accept(token), 400, "VALIDATION_FAILED");
    expect(error.fieldErrors).toEqual({
      name: [expect.any(String)],
      password: [expect.any(String)],
    });
  });

  it("sin sesión y con cuenta existente pide entrar con ella", async () => {
    const s = await scenario();
    const existing = await createUser();
    const { token } = await inviteStaff(s, existing.email);
    const error = await expectError(
      await accept(token, { body: { name: "Ana", password } }),
      401,
      "AUTH_REQUIRED",
    );
    expect(error.message).toBe("Entra con tu cuenta para aceptar la invitación.");
  });

  it("con sesión y el mismo correo crea la membresía y verifica el correo", async () => {
    const s = await scenario();
    const invited = await createUser({ emailVerified: false });
    const { token } = await inviteStaff(s, invited.email);
    const response = await accept(token, { cookie: invited.cookie, turnstile: null });
    expect(response.status).toBe(200);
    const user = await db().select().from(users).where(eq(users.id, invited.id)).get();
    expect(user?.emailVerified).toBe(true);
    const org = await callApi("GET", `/v1/orgs/${s.org.orgId}`, { cookie: invited.cookie });
    expect(org.status).toBe(200);
  });

  it("con sesión y otro correo responde CONFLICT", async () => {
    const s = await scenario();
    const someone = await createUser();
    const { token } = await inviteStaff(s);
    const error = await expectError(
      await accept(token, { cookie: someone.cookie, turnstile: null }),
      409,
      "CONFLICT",
    );
    expect(error.message).toBe("Esta invitación es para otro correo.");
  });

  it("reactiva a un miembro removido con el rol de la invitación", async () => {
    const s = await scenario();
    const former = await createUser();
    const formerId = await addMember({
      orgId: s.org.orgId,
      userId: former.id,
      role: "admin",
      status: "removed",
    });
    const { token } = await inviteStaff(s, former.email);
    expect((await accept(token, { cookie: former.cookie, turnstile: null })).status).toBe(200);
    const member = await db()
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.id, formerId))
      .get();
    expect(member).toMatchObject({ role: "staff", status: "active" });
  });

  it("una invitación vencida o revocada da un error claro", async () => {
    const s = await scenario();
    const expired = await inviteStaff(s);
    await db()
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, expired.invitation.id));
    const expiredError = await expectError(
      await accept(expired.token, { body: { name: "Ana", password } }),
      422,
      "BUSINESS_RULE",
    );
    expect(expiredError.message).toContain("venció");

    const revoked = await inviteStaff(s);
    await callApi("DELETE", `${s.path}/${revoked.invitation.id}`, { cookie: s.owner.cookie });
    const revokedError = await expectError(
      await accept(revoked.token, { body: { name: "Ana", password } }),
      422,
      "BUSINESS_RULE",
    );
    expect(revokedError.message).toContain("canceló");
  });
});

describe("Canje de invitación en un solo batch", () => {
  it("si la invitación se revocó entre la lectura y el batch, no escribe nada", async () => {
    const s = await scenario();
    const invited = await createUser({ emailVerified: false });
    const { invitation } = await inviteStaff(s, invited.email);
    // Otra petición la revoca después de que el servicio la leyó como vigente.
    await db()
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(eq(invitations.id, invitation.id));
    const claim = {
      invitationId: invitation.id,
      orgId: s.org.orgId,
      userId: invited.id,
      role: "staff" as const,
      branchIds: [s.branchA],
      memberId: newId(),
      reactivate: false,
      now: new Date(),
    };
    const database = db();
    const [claimed] = await database.batch([
      ...claimInvitationStatements(database, claim),
      emailVerifiedStatement(database, invited.id, invitationClaimed(database, claim)),
    ]);
    expect(claimed.meta.changes).toBe(0);
    const member = await database
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.id, claim.memberId))
      .get();
    expect(member).toBeUndefined();
    const branches = await database
      .select()
      .from(memberBranches)
      .where(eq(memberBranches.memberId, claim.memberId));
    expect(branches).toEqual([]);
    const user = await database.select().from(users).where(eq(users.id, invited.id)).get();
    expect(user?.emailVerified).toBe(false);
  });
});
