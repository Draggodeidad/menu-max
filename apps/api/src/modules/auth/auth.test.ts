import {
  ErrorResponse,
  GetSessionDto,
  LinkSentDto,
  MeDto,
  ResetPasswordDto,
  SignInDto,
  SignOutDto,
  VerifyEmailDto,
} from "@menu-max/contracts";
import { rateCounters, sessions, users } from "@menu-max/database";
import { createEmailVerificationToken } from "better-auth/api";
import type { JobMessage } from "@menu-max/contracts";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, inArray, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv, type Env } from "../../env";
import worker from "../../index";
import { createDb } from "../../infrastructure/db";
import { createAuth } from "./auth";

const password = "Contraseña de prueba 4817";
const newPassword = "Otra contraseña de prueba 9723";
const compromisedPassword = "Contraseña filtrada 1642";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const REJECTED_TURNSTILE = "token-rechazado";

beforeEach(async () => {
  const bytes = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(compromisedPassword));
  const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
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
          duplicate || token === REJECTED_TURNSTILE
            ? { success: false, "error-codes": ["timeout-or-duplicate"] }
            : { success: true, "error-codes": [] },
        ),
      );
    }
    if (url.origin !== "https://api.pwnedpasswords.com")
      throw new Error("Petición externa inesperada.");
    const prefix = url.pathname.split("/").at(-1);
    return Promise.resolve(new Response(prefix === hash.slice(0, 5) ? `${hash.slice(5)}:1` : ""));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

function randomIp() {
  const [a, b] = crypto.randomUUID().split("-");
  return `2001:db8::${a?.slice(0, 4)}:${b}`;
}

async function request(
  path: string,
  init: RequestInit<IncomingRequestCfProperties> = {},
  bindings: Env = getEnv(env),
) {
  const headers = new Headers(init.headers);
  headers.set("x-mm-internal", bindings.INTERNAL_TOKEN);
  // IP distinta por petición para no chocar con RL_AUTH (10/60 s) salvo que la prueba fije una.
  if (!headers.has("x-client-ip")) headers.set("x-client-ip", randomIp());
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://api.internal/v1/${path}`, { ...init, headers }),
    bindings,
    ctx,
  );
  // Espera lo encolado con `waitUntil` para poder inspeccionarlo.
  await waitOnExecutionContext(ctx);
  return response;
}

function post(path: string, body?: object, headers?: HeadersInit, bindings: Env = getEnv(env)) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("origin")) requestHeaders.set("origin", bindings.WEB_ORIGIN);
  if (body) requestHeaders.set("content-type", "application/json");
  return request(
    `auth/${path}`,
    {
      method: "POST",
      headers: requestHeaders,
      body: body && JSON.stringify(body),
    },
    bindings,
  );
}

async function register(bindings: Env = getEnv(env)) {
  const email = `prueba-${crypto.randomUUID()}@example.com`;
  const { user } = await createAuth(bindings).api.signUpEmail({
    body: { email, name: "Prueba", password },
  });
  return user;
}

const TURNSTILE = "x-turnstile-token";

/** Token del único correo encolado con esa plantilla; el enlace apunta a WEB, no a la API. */
function tokenFrom(sent: JobMessage[], template: string, path: string) {
  const jobs = sent.filter((job) => job.template === template);
  expect(jobs).toHaveLength(1);
  const url = new URL(jobs[0]?.data.url ?? "");
  expect(url.origin).toBe(env.WEB_ORIGIN);
  expect(url.pathname).toBe(path);
  expect([...url.searchParams.keys()]).toEqual(["token"]);
  return url.searchParams.get("token") ?? "";
}

function sessionCookie(response: Response) {
  const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token="));
  expect(cookie).toBeDefined();
  if (!cookie) throw new Error("Falta la cookie de sesión.");
  return { cookie, headers: { cookie: cookie.split(";", 1)[0] ?? "" } };
}

describe("Autenticación con D1", () => {
  it("inicia sesión, devuelve el usuario y cierra la sesión", async () => {
    const { id, email, name } = await register();
    const signedIn = await post("sign-in/email", { email, password }, { origin: env.WEB_ORIGIN });
    expect(signedIn.status).toBe(200);
    expect(SignInDto.parse(await signedIn.json()).user.id).toBe(id);
    const { cookie, headers } = sessionCookie(signedIn);
    expect(cookie).toMatch(/; HttpOnly(?:;|$)/i);
    expect(cookie).toMatch(/; SameSite=Lax(?:;|$)/i);
    expect(cookie).not.toMatch(/; Secure(?:;|$)/i);
    expect(cookie).toContain("Max-Age=604800");

    const me = await request("me", { headers });
    expect(me.status).toBe(200);
    expect(MeDto.parse(await me.json())).toEqual({
      user: { id, email, name, emailVerified: false },
    });

    const session = await request("auth/get-session", { headers });
    expect(session.status).toBe(200);
    expect(GetSessionDto.parse(await session.json())?.session.userId).toBe(id);

    const signedOut = await request("auth/sign-out", {
      method: "POST",
      headers: { ...headers, origin: env.WEB_ORIGIN },
      body: "",
    });
    expect(signedOut.status).toBe(200);
    expect(SignOutDto.parse(await signedOut.json())).toEqual({ success: true });
    expect(sessionCookie(signedOut).cookie).toContain("Max-Age=0");
    expect((await request("me", { headers })).status).toBe(401);
  });

  it("renueva una sesión tras un día y reenvía la cookie", async () => {
    const { id, email } = await register();
    const { headers } = sessionCookie(await post("sign-in/email", { email, password }));
    const db = createDb(getEnv(env));
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) })
      .where(eq(sessions.userId, id));
    const me = await request("me", { headers });
    expect(me.status).toBe(200);
    expect(sessionCookie(me).cookie).toContain("Max-Age=604800");
  });

  it.each(["staging", "production"] as const)(
    "emite una cookie Secure en %s",
    async (environment) => {
      const { email } = await register();
      const bindings = { ...getEnv(env), ENVIRONMENT: environment };
      const response = await post("sign-in/email", { email, password }, undefined, bindings);
      const { cookie, headers } = sessionCookie(response);
      expect(cookie).toMatch(/^__Secure-/);
      expect(cookie).toMatch(/; Secure(?:;|$)/i);
      expect((await request("me", { headers }, bindings)).status).toBe(200);
    },
  );

  it("requiere sesión en /me y conserva la guarda interna en auth", async () => {
    const me = await request("me");
    expect(me.status).toBe(401);
    expect(ErrorResponse.parse(await me.json()).code).toBe("AUTH_REQUIRED");
    const response = await worker.fetch(
      new Request("https://api.internal/v1/auth/get-session"),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("rechaza métodos y rutas fuera de la lista permitida", async () => {
    expect(
      (await post("sign-up/email", { email: "prueba@example.com", password, name: "Prueba" }))
        .status,
    ).toBe(404);
    expect((await request("auth/list-sessions")).status).toBe(404);
    expect((await request("auth/sign-in/email")).status).toBe(404);
    expect((await request("auth/reference")).status).toBe(404);
  });

  it("rechaza un origen ajeno en mutaciones y destinos de redirección", async () => {
    const { email } = await register();
    const origin = "https://ajeno.example";
    const foreign = await post("sign-in/email", { email, password }, { origin });
    expect(foreign.status).toBe(403);
    // Los enlaces apuntan a WEB: la API ya no acepta destinos de redirección.
    const redirect = await request(`auth/verify-email?token=invalido&callbackURL=${origin}`);
    expect(redirect.status).toBe(400);
    expect((await post("request-password-reset", { email, redirectTo: origin })).status).toBe(400);
    expect((await request("auth/reset-password/token?callbackURL=/")).status).toBe(404);
  });

  it("rechaza datos extra, JSON inválido y tipos de contenido ajenos a JSON", async () => {
    const { email } = await register();
    const invalid = await post("sign-in/email", { email, password, emailVerified: true });
    expect(invalid.status).toBe(400);
    expect(ErrorResponse.parse(await invalid.json()).code).toBe("VALIDATION_FAILED");
    const malformed = await request("auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const plainText = await request("auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ email, password }),
    });
    expect(plainText.status).toBe(400);
  });

  it.each([
    ["123456789", undefined],
    [compromisedPassword, "Esta contraseña se ha filtrado. Elige otra."],
  ])("rechaza una contraseña nueva inválida (caso %#)", async (rejected, message) => {
    const { email } = await register();
    const { headers } = sessionCookie(await post("sign-in/email", { email, password }));
    const response = await post(
      "change-password",
      { currentPassword: password, newPassword: rejected },
      headers,
    );
    expect(response.status).toBe(400);
    const error = ErrorResponse.parse(await response.json());
    expect(error.code).toBe("VALIDATION_FAILED");
    if (message) expect(error.message).toBe(message);
    expect((await request("me", { headers })).status).toBe(200);
  });

  it("revoca las demás sesiones al cambiar la contraseña aunque el cliente envíe false", async () => {
    const { bindings, sent } = withJobs();
    const { email } = await register(bindings);
    const first = sessionCookie(await post("sign-in/email", { email, password }));
    const second = sessionCookie(await post("sign-in/email", { email, password }));
    sent.length = 0;
    const changed = await post(
      "change-password",
      {
        currentPassword: password,
        newPassword,
        revokeOtherSessions: false,
      },
      first.headers,
      bindings,
    );
    expect(changed.status).toBe(200);
    expect(sent).toEqual([
      expect.objectContaining({
        to: email,
        template: "password-changed",
        data: { url: `${env.WEB_ORIGIN}/restablecer` },
      }),
    ]);
    expect((await request("me", { headers: second.headers })).status).toBe(401);
    expect((await request("me", { headers: sessionCookie(changed).headers })).status).toBe(200);
    expect((await post("sign-in/email", { email, password })).status).toBe(401);
    expect((await post("sign-in/email", { email, password: newPassword })).status).toBe(200);
  });

  it("verifica el correo con un enlace válido", async () => {
    const { id, email } = await register();
    const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, email, undefined, 60, {
      userId: id,
    });
    const response = await request(`auth/verify-email?${new URLSearchParams({ token })}`);
    expect(response.status).toBe(200);
    expect(VerifyEmailDto.parse(await response.json()).status).toBe(true);
    const invalid = await request("auth/verify-email?token=invalido");
    expect(invalid.status).toBe(400);
    expect(ErrorResponse.parse(await invalid.json()).code).toBe("VALIDATION_FAILED");

    const { headers } = sessionCookie(await post("sign-in/email", { email, password }));
    expect(MeDto.parse(await (await request("me", { headers })).json()).user.emailVerified).toBe(
      true,
    );
  });

  it("canjea un enlace de restablecimiento una vez y revoca las sesiones", async () => {
    const { bindings, sent } = withJobs();
    const { email } = await register(bindings);
    const first = sessionCookie(await post("sign-in/email", { email, password }));
    const second = sessionCookie(await post("sign-in/email", { email, password }));
    sent.length = 0;

    const requested = await post(
      "request-password-reset",
      { email },
      { [TURNSTILE]: crypto.randomUUID() },
      bindings,
    );
    expect(requested.status).toBe(202);
    const token = tokenFrom(sent, "reset-password", "/restablecer");

    const response = await post("reset-password", { token, newPassword }, undefined, bindings);
    expect(response.status).toBe(200);
    expect(ResetPasswordDto.parse(await response.json()).status).toBe(true);
    expect((await request("me", { headers: first.headers })).status).toBe(401);
    expect((await request("me", { headers: second.headers })).status).toBe(401);
    expect(sent.at(-1)).toMatchObject({
      to: email,
      template: "password-changed",
      data: { url: `${env.WEB_ORIGIN}/restablecer` },
    });

    const reused = await post("reset-password", { token, newPassword: password });
    expect(reused.status).toBe(400);
    expect(ErrorResponse.parse(await reused.json()).code).toBe("VALIDATION_FAILED");
    expect((await post("sign-in/email", { email, password: newPassword })).status).toBe(200);
  });

  it("aplica la columna de estado con su valor por defecto y restringe otros valores", async () => {
    const { id } = await register();
    const db = createDb(getEnv(env));
    const rows = await db
      .select({ emailStatus: users.emailStatus })
      .from(users)
      .where(eq(users.id, id));
    expect(rows).toEqual([{ emailStatus: "ok" }]);
    await expect(
      env.DB.prepare("UPDATE users SET email_status = ? WHERE id = ?").bind("invalido", id).run(),
    ).rejects.toThrow();
  });
});

const wrongPassword = "Contraseña equivocada 0000";

function signInFrom(ip: string, email: string, attempt: string) {
  return post("sign-in/email", { email, password: attempt }, { "x-client-ip": ip });
}

async function statuses(count: number, call: (i: number) => Response | Promise<Response>) {
  const responses = await Promise.all(Array.from({ length: count }, (_, i) => call(i)));
  return responses.map((response) => response.status);
}

describe("Bloqueo de inicio de sesión (5 fallos en 15 min por correo + IP)", () => {
  it("responde 429 al sexto intento aunque la contraseña sea correcta", async () => {
    const { email } = await register();
    const ip = randomIp();
    // Mayúsculas y minúsculas cuentan para la misma llave.
    const failures = await statuses(5, (i) =>
      signInFrom(ip, i % 2 === 0 ? email : email.toUpperCase(), wrongPassword),
    );
    expect(failures).toEqual(Array(5).fill(401));

    const locked = await signInFrom(ip, email, password);
    expect(locked.status).toBe(429);
    const error = ErrorResponse.parse(await locked.json());
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message).toMatch(/restablece tu contraseña/);
    const retryAfter = Number(locked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(locked.headers.getSetCookie()).toEqual([]);

    // La llave es correo + IP: desde otra IP la cuenta sigue funcionando.
    expect((await signInFrom(randomIp(), email, password)).status).toBe(200);
  });

  it("no guarda el correo en claro en rate_counters", async () => {
    const { email } = await register();
    const ip = randomIp();
    await signInFrom(ip, email, wrongPassword);

    const rows = await createDb(getEnv(env))
      .select({ key: rateCounters.key, count: rateCounters.count })
      .from(rateCounters)
      .where(like(rateCounters.key, `login-fail:%:${ip}`));
    expect(rows).toEqual([{ key: expect.stringMatching(/^login-fail:[\da-f]{64}:/), count: 1 }]);
    expect(rows[0]?.key).not.toContain(email.split("@")[0]);
  });

  it("no cuenta los inicios de sesión correctos", async () => {
    const { email } = await register();
    const ip = randomIp();
    expect(await statuses(4, () => signInFrom(ip, email, wrongPassword))).toEqual(
      Array(4).fill(401),
    );
    expect(await statuses(3, () => signInFrom(ip, email, password))).toEqual(Array(3).fill(200));
    expect((await signInFrom(ip, email, wrongPassword)).status).toBe(401);
    expect((await signInFrom(ip, email, password)).status).toBe(429);
  });

  it("bloquea igual un correo sin cuenta, sin revelar si existe", async () => {
    const email = `nadie-${crypto.randomUUID()}@example.com`;
    const ip = randomIp();
    expect(await statuses(5, () => signInFrom(ip, email, wrongPassword))).toEqual(
      Array(5).fill(401),
    );
    expect((await signInFrom(ip, email, wrongPassword)).status).toBe(429);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fija el reloj a mitad de una ventana para que las cuotas no crucen de hora o de día. */
function freezeClock(at: number) {
  vi.useFakeTimers({ toFake: ["Date"], now: at });
}

describe("Verificación de correo (T10)", () => {
  it("el alta encola verify-email con un enlace a WEB que verifica e inicia sesión una sola vez", async () => {
    const { bindings, sent } = withJobs();
    const { id, email, name } = await register(bindings);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "email.send", to: email, template: "verify-email" });
    // El correo solo lleva el enlace: ningún token de sesión ni otros datos.
    expect(Object.keys(sent[0]?.data ?? {})).toEqual(["url"]);
    const token = tokenFrom(sent, "verify-email", "/verificar-correo");

    const verified = await request(`auth/verify-email?${new URLSearchParams({ token })}`);
    expect(verified.status).toBe(200);
    expect(VerifyEmailDto.parse(await verified.json()).status).toBe(true);
    const { headers } = sessionCookie(verified);
    const me = await request("me", { headers });
    expect(MeDto.parse(await me.json())).toEqual({
      user: { id, email, name, emailVerified: true },
    });

    const reused = await request(`auth/verify-email?${new URLSearchParams({ token })}`);
    expect(reused.status).toBe(409);
    expect(ErrorResponse.parse(await reused.json())).toMatchObject({
      code: "CONFLICT",
      message: "Este enlace ya se usó. Si ya confirmaste tu correo, solo entra.",
    });
    expect(reused.headers.getSetCookie()).toEqual([]);
  });

  it("rechaza un enlace vencido con el formato de error de la API", async () => {
    const { id, email } = await register();
    const token = await createEmailVerificationToken(
      env.BETTER_AUTH_SECRET,
      email,
      undefined,
      -60,
      {
        userId: id,
      },
    );
    const expired = await request(`auth/verify-email?${new URLSearchParams({ token })}`);
    expect(expired.status).toBe(400);
    expect(ErrorResponse.parse(await expired.json()).code).toBe("VALIDATION_FAILED");
    expect(expired.headers.getSetCookie()).toEqual([]);
  });

  it("reenvía la verificación al correo de la sesión con 1 cada 60 s", async () => {
    const { bindings, sent } = withJobs();
    const { email } = await register(bindings);
    const { headers } = sessionCookie(await post("sign-in/email", { email, password }));
    sent.length = 0;

    expect((await post("send-verification-email", {}, undefined, bindings)).status).toBe(401);
    expect((await post("send-verification-email", { email }, headers, bindings)).status).toBe(400);

    const resent = await post("send-verification-email", {}, headers, bindings);
    expect(resent.status).toBe(202);
    expect(LinkSentDto.parse(await resent.json())).toEqual({
      message: "Si el correo existe, te enviamos un enlace.",
    });
    expect(sent).toEqual([expect.objectContaining({ to: email, template: "verify-email" })]);

    const tooSoon = await post("send-verification-email", {}, headers, bindings);
    expect(tooSoon.status).toBe(429);
    expect(ErrorResponse.parse(await tooSoon.json()).code).toBe("RATE_LIMITED");
    const retryAfter = Number(tooSoon.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(sent).toHaveLength(1);
  });

  it("bloquea el sexto reenvío del día hasta el fin de la ventana UTC", async () => {
    const dayStart = Math.floor(Date.now() / DAY_MS) * DAY_MS + DAY_MS;
    freezeClock(dayStart + 60 * 60 * 1000);
    const { bindings, sent } = withJobs();
    const { email } = await register(bindings);
    const { headers } = sessionCookie(await post("sign-in/email", { email, password }));
    sent.length = 0;

    // Uno por minuto: deben ir en orden, con el reloj avanzando entre llamadas.
    const resent = await Array.from({ length: 5 }).reduce<Promise<number[]>>(
      async (previous, _, i) => {
        const done = await previous;
        vi.setSystemTime(dayStart + 60 * 60 * 1000 + i * 61_000);
        const response = await post("send-verification-email", {}, headers, bindings);
        return [...done, response.status];
      },
      Promise.resolve([]),
    );
    expect(resent).toEqual([202, 202, 202, 202, 202]);
    const now = dayStart + 60 * 60 * 1000 + 5 * 61_000;
    vi.setSystemTime(now);
    const sixth = await post("send-verification-email", {}, headers, bindings);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBe(
      Math.ceil((dayStart + DAY_MS - now) / 1000),
    );
    expect(sent).toHaveLength(5);
  });

  it.each([
    ["ya está verificado", { emailVerified: true }],
    ["no es entregable", { emailStatus: "undeliverable" as const }],
  ])("responde igual sin encolar ni gastar cuota si el correo %s", async (_case, change) => {
    const { bindings, sent } = withJobs();
    const db = createDb(bindings);
    const { id, email } = await register(bindings);
    await db.update(users).set(change).where(eq(users.id, id));
    const { headers } = sessionCookie(await post("sign-in/email", { email, password }));
    sent.length = 0;

    // Dos seguidos: si alguno gastara cuota, el segundo respondería 429.
    const first = await post("send-verification-email", {}, headers, bindings);
    const second = await post("send-verification-email", {}, headers, bindings);
    expect([first.status, second.status]).toEqual([202, 202]);
    expect(LinkSentDto.parse(await second.json()).message).toBe(
      "Si el correo existe, te enviamos un enlace.",
    );
    expect(sent).toEqual([]);
    const counters = await db
      .select()
      .from(rateCounters)
      .where(inArray(rateCounters.key, [`verify-resend-min:${id}`, `verify-resend-day:${id}`]));
    expect(counters).toEqual([]);
  });
});

function requestReset(
  email: string,
  bindings: Env,
  turnstile: string | null = crypto.randomUUID(),
) {
  return post(
    "request-password-reset",
    { email },
    turnstile ? { [TURNSTILE]: turnstile } : {},
    bindings,
  );
}

/** Nombres de headers sin el `x-request-id`, que cambia en cada respuesta. */
function headerNames(response: Response) {
  return new Set([...response.headers.keys()].filter((name) => name !== "x-request-id"));
}

describe("Restablecimiento de contraseña (T10)", () => {
  it("responde lo mismo exista o no el correo y solo encola para el que existe", async () => {
    const { bindings, sent } = withJobs();
    const { email } = await register(bindings);
    sent.length = 0;

    const known = await requestReset(email, bindings);
    const unknown = await requestReset(`ausente-${crypto.randomUUID()}@example.com`, bindings);
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    const body = LinkSentDto.parse(await known.json());
    expect(await unknown.json()).toEqual(body);
    expect(headerNames(unknown)).toEqual(headerNames(known));
    expect(known.headers.getSetCookie()).toEqual([]);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email, template: "reset-password" });
    expect(Object.keys(sent[0]?.data ?? {})).toEqual(["url"]);
    tokenFrom(sent, "reset-password", "/restablecer");
  });

  it("exige Turnstile válido y de un solo uso antes de gastar la cuota", async () => {
    const { bindings, sent } = withJobs();
    const { email } = await register(bindings);
    sent.length = 0;

    const rejected = await Promise.all(
      [null, REJECTED_TURNSTILE].map((token) => requestReset(email, bindings, token)),
    );
    const errors = await Promise.all(rejected.map((response) => response.json()));
    expect(rejected.map((response) => response.status)).toEqual([400, 400]);
    for (const error of errors) {
      expect(ErrorResponse.parse(error)).toMatchObject({
        code: "VALIDATION_FAILED",
        fieldErrors: { turnstileToken: [expect.any(String)] },
      });
    }
    const token = crypto.randomUUID();
    expect((await requestReset(email, bindings, token)).status).toBe(202);
    expect((await requestReset(email, bindings, token)).status).toBe(400);
    // Los rechazos de Turnstile no gastaron cuota: caben dos más de las tres por hora.
    expect(await statuses(2, () => requestReset(email, bindings))).toEqual([202, 202]);
    expect(sent).toHaveLength(3);
  });

  it.each([
    ["inexistente", false],
    ["existente", true],
  ])("responde 429 al cuarto intento en la hora con un correo %s", async (_case, exists) => {
    const hourMs = 60 * 60 * 1000;
    const now = Math.floor(Date.now() / hourMs) * hourMs + hourMs + 30 * 60 * 1000;
    freezeClock(now);
    const { bindings, sent } = withJobs();
    const email = exists
      ? (await register(bindings)).email
      : `ausente-${crypto.randomUUID()}@example.com`;
    sent.length = 0;

    expect(await statuses(3, () => requestReset(email, bindings))).toEqual([202, 202, 202]);
    // Mismo correo normalizado: las mayúsculas no abren otra cuota.
    const fourth = await requestReset(email.toUpperCase(), bindings);
    expect(fourth.status).toBe(429);
    expect(ErrorResponse.parse(await fourth.json()).code).toBe("RATE_LIMITED");
    expect(Number(fourth.headers.get("retry-after"))).toBe(30 * 60);
    expect(sent).toHaveLength(exists ? 3 : 0);
  });
});
