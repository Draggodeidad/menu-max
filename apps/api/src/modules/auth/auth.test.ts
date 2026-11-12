import {
  ErrorResponse,
  GetSessionDto,
  MeDto,
  ResetPasswordDto,
  SignInDto,
  SignOutDto,
  VerifyEmailDto,
} from "@menu-max/contracts";
import { sessions, users } from "@menu-max/database";
import { createEmailVerificationToken } from "better-auth/api";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv, type Env } from "../../env";
import worker from "../../index";
import { createDb } from "../../infrastructure/db";
import { newPublicToken } from "../../shared/ids";
import { createAuth } from "./auth";

const password = "Contraseña de prueba 4817";
const newPassword = "Otra contraseña de prueba 9723";
const compromisedPassword = "Contraseña filtrada 1642";

beforeEach(async () => {
  const bytes = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(compromisedPassword));
  const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://api.pwnedpasswords.com")
      throw new Error("Petición externa inesperada.");
    const prefix = url.pathname.split("/").at(-1);
    return Promise.resolve(new Response(prefix === hash.slice(0, 5) ? `${hash.slice(5)}:1` : ""));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(
  path: string,
  init: RequestInit<IncomingRequestCfProperties> = {},
  bindings: Env = getEnv(env),
) {
  const headers = new Headers(init.headers);
  headers.set("x-mm-internal", bindings.INTERNAL_TOKEN);
  return worker.fetch(
    new Request(`https://api.internal/v1/${path}`, { ...init, headers }),
    bindings,
    createExecutionContext(),
  );
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

async function register() {
  const email = `prueba-${crypto.randomUUID()}@example.com`;
  const { user } = await createAuth(getEnv(env)).api.signUpEmail({
    body: { email, name: "Prueba", password },
  });
  return user;
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

  it("rechaza un origen ajeno en mutaciones y redirecciones fuera de WEB", async () => {
    const { email } = await register();
    const origin = "https://ajeno.example";
    const foreign = await post("sign-in/email", { email, password }, { origin });
    expect(foreign.status).toBe(403);
    const redirect = await request(`auth/verify-email?token=invalido&callbackURL=${origin}`);
    expect(redirect.status).toBe(403);
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
    const { email } = await register();
    const first = sessionCookie(await post("sign-in/email", { email, password }));
    const second = sessionCookie(await post("sign-in/email", { email, password }));
    const changed = await post(
      "change-password",
      {
        currentPassword: password,
        newPassword,
        revokeOtherSessions: false,
      },
      first.headers,
    );
    expect(changed.status).toBe(200);
    expect((await request("me", { headers: second.headers })).status).toBe(401);
    expect((await request("me", { headers: sessionCookie(changed).headers })).status).toBe(200);
    expect((await post("sign-in/email", { email, password })).status).toBe(401);
    expect((await post("sign-in/email", { email, password: newPassword })).status).toBe(200);
  });

  it.each(["request-password-reset", "send-verification-email"])(
    "devuelve el mismo error temporal en %s sin revelar si existe la cuenta",
    async (path) => {
      const { email } = await register();
      const [known, unknown] = await Promise.all([
        post(path, { email }),
        post(path, { email: "ausente@example.com" }),
      ]);
      expect(known.status).toBe(422);
      expect(unknown.status).toBe(422);
      const { code, message } = ErrorResponse.parse(await known.json());
      expect(code).toBe("BUSINESS_RULE");
      expect(ErrorResponse.parse(await unknown.json())).toMatchObject({ code, message });
    },
  );

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
    const { id, email } = await register();
    const { headers } = sessionCookie(await post("sign-in/email", { email, password }));
    const token = newPublicToken();
    const { internalAdapter } = await createAuth(getEnv(env)).$context;
    await internalAdapter.createVerificationValue({
      identifier: `reset-password:${token}`,
      value: id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const callbackURL = new URL("/restablecer", env.WEB_ORIGIN).href;
    const redirect = await request(
      `auth/reset-password/${token}?${new URLSearchParams({ callbackURL })}`,
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`${callbackURL}?token=${token}`);
    const response = await post("reset-password", { token, newPassword });
    expect(response.status).toBe(200);
    expect(ResetPasswordDto.parse(await response.json()).status).toBe(true);
    expect((await request("me", { headers })).status).toBe(401);
    expect((await post("reset-password", { token, newPassword })).status).toBe(400);
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
