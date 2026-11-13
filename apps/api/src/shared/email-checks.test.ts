import { emailDomainChecks } from "@menu-max/database";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "../env";
import { createDb } from "../infrastructure/db";
import {
  assertDeliverableEmail,
  domainHasMail,
  isDisposableDomain,
  normalizeEmail,
} from "./email-checks";
import { AppError } from "./errors";

const MX = 15;
const A = 1;
type Record = { type: number; data: string };
type Zone = { status?: number; mx?: Record[]; a?: Record[] } | "down";

// DoH simulado: ninguna prueba consulta DNS real.
let zones: Map<string, Zone>;
const dnsCalls: string[] = [];

function fakeDoh(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin + url.pathname !== "https://cloudflare-dns.com/dns-query") {
    throw new Error(`Petición externa inesperada: ${url.href}`);
  }
  expect(new Headers(init?.headers).get("accept")).toBe("application/dns-json");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  const name = url.searchParams.get("name") ?? "";
  const type = Number(url.searchParams.get("type"));
  dnsCalls.push(`${name}:${type}`);
  const zone = zones.get(name) ?? { status: 3 };
  if (zone === "down") return Promise.reject(new Error("sin red"));
  const answer = type === MX ? zone.mx : zone.a;
  return Promise.resolve(Response.json({ Status: zone.status ?? 0, Answer: answer }));
}

const deps = () => ({ db: createDb(getEnv(env)), requestId: "prueba" });
const unique = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}.mx`;

beforeEach(() => {
  zones = new Map();
  dnsCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(fakeDoh));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  expect(appError.code).toBe("VALIDATION_FAILED");
  expect(appError.fieldErrors?.email).toEqual([appError.message]);
  return appError.message;
}

describe("normalizeEmail", () => {
  it("recorta y pasa a minúsculas", () => {
    expect(normalizeEmail("  Dueno.Tacos@Example.MX ")).toBe("dueno.tacos@example.mx");
  });

  // 255 caracteres con etiquetas válidas: solo falla por longitud.
  const tooLong = `${"a".repeat(64)}@${["b", "c", "d"].map((c) => c.repeat(60)).join(".")}.eeee.mx`;

  it("acepta un correo de 254 caracteres", () => {
    expect(normalizeEmail(tooLong.slice(1))).toBe(tooLong.slice(1));
  });

  it.each(["sin-arroba", "a@b", tooLong])(
    "rechaza correos mal escritos o de más de 254 caracteres (caso %#)",
    (email) => {
      expect(() => normalizeEmail(email)).toThrow("Revisa que el correo esté bien escrito.");
    },
  );
});

describe("isDisposableDomain", () => {
  it("detecta el dominio y sus subdominios, pero no dominios que solo se parecen", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("correo.mailinator.com")).toBe(true);
    expect(isDisposableDomain("xmailinator.com")).toBe(false);
    expect(isDisposableDomain("mailinator.com.mx")).toBe(false);
    expect(isDisposableDomain("gmail.com")).toBe(false);
  });
});

describe("assertDeliverableEmail", () => {
  it("rechaza un dominio desechable sin consultar DNS", async () => {
    expect(await rejection(assertDeliverableEmail(deps(), "bot@Mailinator.com"))).toBe(
      "Usa un correo que revises seguido.",
    );
    expect(dnsCalls).toEqual([]);
  });

  it("acepta un dominio con MX y devuelve el correo normalizado", async () => {
    const domain = unique("tacos");
    zones.set(domain, { mx: [{ type: MX, data: "10 mx.tacos.mx." }] });
    expect(await assertDeliverableEmail(deps(), ` Hola@${domain.toUpperCase()} `)).toBe(
      `hola@${domain}`,
    );
  });

  it("acepta un dominio sin MX pero con registro A (MX implícito)", async () => {
    const domain = unique("solo-a");
    zones.set(domain, { mx: [], a: [{ type: A, data: "192.0.2.1" }] });
    await expect(assertDeliverableEmail(deps(), `hola@${domain}`)).resolves.toBe(`hola@${domain}`);
    expect(dnsCalls).toEqual([`${domain}:${MX}`, `${domain}:${A}`]);
  });

  it("ignora registros de otro tipo en la respuesta (CNAME)", async () => {
    const domain = unique("cname");
    zones.set(domain, { mx: [{ type: 5, data: "otro.mx." }], a: [{ type: 5, data: "otro.mx." }] });
    expect(await rejection(assertDeliverableEmail(deps(), `hola@${domain}`))).toBe(
      "Revisa que el correo esté bien escrito.",
    );
  });

  it.each<[string, Zone]>([
    ["sin MX ni A", { mx: [], a: [] }],
    ["inexistente (NXDOMAIN)", { status: 3 }],
    ["con MX nulo", { mx: [{ type: MX, data: "0 ." }] }],
  ])("rechaza un dominio %s", async (_case, zone) => {
    const domain = unique("sin-correo");
    zones.set(domain, zone);
    expect(await rejection(assertDeliverableEmail(deps(), `hola@${domain}`))).toBe(
      "Revisa que el correo esté bien escrito.",
    );
  });

  it("guarda el resultado y lo reutiliza durante 24 h", async () => {
    const domain = unique("cache");
    zones.set(domain, { mx: [], a: [] });
    const now = Date.now();

    expect(await domainHasMail(deps(), domain, now)).toBe(false);
    expect(dnsCalls).toHaveLength(2);
    const [row] = await deps()
      .db.select()
      .from(emailDomainChecks)
      .where(eq(emailDomainChecks.domain, domain));
    expect(row).toEqual({ domain, hasMail: false, checkedAt: now });

    zones.set(domain, { mx: [{ type: MX, data: "10 mx.cache.mx." }] });
    expect(await domainHasMail(deps(), domain, now + 23 * 60 * 60 * 1000)).toBe(false);
    expect(dnsCalls).toHaveLength(2);

    expect(await domainHasMail(deps(), domain, now + 25 * 60 * 60 * 1000)).toBe(true);
    expect(dnsCalls).toHaveLength(3);
  });

  it.each<[string, Zone]>([
    ["DoH no responde", "down"],
    ["DoH devuelve SERVFAIL", { status: 2 }],
  ])("deja pasar el correo sin guardar nada si %s", async (_case, zone) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const domain = unique("caido");
    zones.set(domain, zone);

    await expect(assertDeliverableEmail(deps(), `hola@${domain}`)).resolves.toBe(`hola@${domain}`);
    const rows = await deps()
      .db.select()
      .from(emailDomainChecks)
      .where(eq(emailDomainChecks.domain, domain));
    expect(rows).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("email.domain_check_unavailable");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(domain);
  });
});
