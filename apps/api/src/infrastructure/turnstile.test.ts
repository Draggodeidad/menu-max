import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../shared/errors";
import { verifyTurnstile } from "./turnstile";

// Claves de prueba de Cloudflare. siteverify se simula: ninguna prueba sale a la red.
const ALWAYS_PASSES = "1x0000000000000000000000000000000AA";
const ALWAYS_FAILS = "2x0000000000000000000000000000000AA";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const calls: FormData[] = [];

/** Imita siteverify con las claves de prueba, incluido el rechazo de un token reutilizado. */
function fakeSiteverify() {
  const used = new Set<string>();
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== SITEVERIFY) throw new Error(`Petición externa inesperada: ${url}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const form = init?.body as FormData;
    calls.push(form);
    const secret = form.get("secret");
    const token = String(form.get("response"));
    if (secret === ALWAYS_FAILS) {
      return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
    }
    if (secret !== ALWAYS_PASSES) {
      return Response.json({ success: false, "error-codes": ["invalid-input-secret"] });
    }
    if (used.has(token)) {
      return Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] });
    }
    used.add(token);
    return Response.json({ success: true, "error-codes": [] });
  };
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(fakeSiteverify()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function expectRejected(promise: Promise<void>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({
    code: "VALIDATION_FAILED",
    fieldErrors: { turnstileToken: [expect.any(String)] },
  });
}

describe("verifyTurnstile", () => {
  it("acepta con la clave de prueba que siempre pasa y envía la IP del cliente", async () => {
    await verifyTurnstile({ TURNSTILE_SECRET_KEY: ALWAYS_PASSES }, "token-1", "192.0.2.10");
    expect(calls[0]?.get("response")).toBe("token-1");
    expect(calls[0]?.get("remoteip")).toBe("192.0.2.10");
  });

  it("rechaza con VALIDATION_FAILED con la clave de prueba que siempre falla", async () => {
    await expectRejected(
      verifyTurnstile({ TURNSTILE_SECRET_KEY: ALWAYS_FAILS }, "token-1", "192.0.2.10"),
    );
  });

  it("rechaza un token reutilizado", async () => {
    const env = { TURNSTILE_SECRET_KEY: ALWAYS_PASSES };
    await verifyTurnstile(env, "token-unico", undefined);
    await expectRejected(verifyTurnstile(env, "token-unico", undefined));
  });

  it.each([undefined, null, "", "x".repeat(2049)])(
    "rechaza un token faltante o demasiado largo sin llamar a Cloudflare (caso %#)",
    async (token) => {
      await expectRejected(
        verifyTurnstile({ TURNSTILE_SECRET_KEY: ALWAYS_PASSES }, token, undefined),
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("no deja pasar la petición si el secreto está mal configurado", async () => {
    const result = verifyTurnstile({ TURNSTILE_SECRET_KEY: "secreto-invalido" }, "t", undefined);
    await expect(result).rejects.toThrow("TURNSTILE_SECRET_KEY no es válida.");
    await expect(result).rejects.not.toBeInstanceOf(AppError);
  });

  it("no deja pasar la petición si Cloudflare falla o no responde", async () => {
    const env = { TURNSTILE_SECRET_KEY: ALWAYS_PASSES };
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 503 })));
    await expect(verifyTurnstile(env, "t", undefined)).rejects.toThrow("HTTP 503");

    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });
    await expect(verifyTurnstile(env, "t", undefined, 5)).rejects.toThrow();
  });
});
