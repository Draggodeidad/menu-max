import { emailDomainChecks } from "@menu-max/database";
import { eq, lt } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../infrastructure/db";
import { DISPOSABLE_DOMAINS } from "./disposable-domains";
import { AppError } from "./errors";
import { log } from "./log";

// Filtros de correo antes de crear una cuenta (ADR-008). Nunca se hace sondeo SMTP.

const MAX_EMAIL_LENGTH = 254;
const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DOH_URL = "https://cloudflare-dns.com/dns-query";
const DNS_TIMEOUT_MS = 10_000;
const DNS_A = 1;
const DNS_MX = 15;
const DNS_NOERROR = 0;
const DNS_NXDOMAIN = 3;

const MISTYPED = "Revisa que el correo esté bien escrito.";
const DISPOSABLE = "Usa un correo que revises seguido.";

export type EmailCheckDeps = { db: Db; requestId: string };

function invalidEmail(message: string) {
  return new AppError("VALIDATION_FAILED", message, { email: [message] });
}

/** Recorta y pasa a minúsculas. Lanza `VALIDATION_FAILED` si no es un correo válido. */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !z.email().safeParse(email).success) {
    throw invalidEmail(MISTYPED);
  }
  return email;
}

/** `true` si el dominio, o alguno de sus dominios padre, está en la lista de desechables. */
export function isDisposableDomain(domain: string): boolean {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

class DnsUnavailable extends Error {}

async function queryDns(domain: string, type: number) {
  const url = new URL(DOH_URL);
  url.searchParams.set("name", domain);
  url.searchParams.set("type", String(type));
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DnsUnavailable("DoH no respondió.", { cause: error });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DnsUnavailable(`DoH respondió HTTP ${response.status}.`);
  }
  const body = await response.json<{ Status?: unknown; Answer?: unknown }>();
  const answers = Array.isArray(body.Answer)
    ? (body.Answer as { type?: unknown; data?: unknown }[])
    : [];
  return {
    status: body.Status,
    records: answers.filter((answer) => answer.type === type).map((answer) => String(answer.data)),
  };
}

/** Resuelve si el dominio recibe correo: MX, o registro A como MX implícito (RFC 5321). */
async function resolveHasMail(domain: string): Promise<boolean> {
  const mx = await queryDns(domain, DNS_MX);
  if (mx.status === DNS_NXDOMAIN) return false;
  if (mx.status !== DNS_NOERROR)
    throw new DnsUnavailable(`DoH devolvió Status ${String(mx.status)}.`);
  // «0 .» es un MX nulo (RFC 7505): el dominio declara que no recibe correo.
  if (mx.records.length > 0) return mx.records.some((record) => !/^\d+\s+\.?$/.test(record.trim()));

  const a = await queryDns(domain, DNS_A);
  if (a.status === DNS_NXDOMAIN) return false;
  if (a.status !== DNS_NOERROR)
    throw new DnsUnavailable(`DoH devolvió Status ${String(a.status)}.`);
  return a.records.length > 0;
}

/**
 * Dice si el dominio recibe correo, con el resultado guardado 24 h en `email_domain_checks`.
 * Si DoH falla, deja pasar el correo sin guardar nada: una falla de DNS no debe bloquear registros.
 */
export async function domainHasMail(
  deps: EmailCheckDeps,
  domain: string,
  now = Date.now(),
): Promise<boolean> {
  const cached = await deps.db
    .select({ hasMail: emailDomainChecks.hasMail, checkedAt: emailDomainChecks.checkedAt })
    .from(emailDomainChecks)
    .where(eq(emailDomainChecks.domain, domain))
    .get();
  if (cached && now - cached.checkedAt < CHECK_TTL_MS) return cached.hasMail;

  let hasMail: boolean;
  try {
    hasMail = await resolveHasMail(domain);
  } catch (error) {
    if (!(error instanceof DnsUnavailable)) throw error;
    log.warn("email.domain_check_unavailable", { requestId: deps.requestId });
    return true;
  }

  await deps.db
    .insert(emailDomainChecks)
    .values({ domain, hasMail, checkedAt: now })
    .onConflictDoUpdate({ target: emailDomainChecks.domain, set: { hasMail, checkedAt: now } });
  return hasMail;
}

/**
 * Normaliza el correo y confirma que puede recibir mensajes: no desechable y con MX (o A).
 * Lanza `VALIDATION_FAILED` con un mensaje accionable; devuelve el correo normalizado.
 */
export async function assertDeliverableEmail(
  deps: EmailCheckDeps,
  rawEmail: string,
): Promise<string> {
  const email = normalizeEmail(rawEmail);
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (isDisposableDomain(domain)) throw invalidEmail(DISPOSABLE);
  if (!(await domainHasMail(deps, domain))) throw invalidEmail(MISTYPED);
  return email;
}

/** Borra los chequeos de más de 7 días. Lo llama el Cron diario. */
export async function deleteStaleEmailDomainChecks(db: Db, now = Date.now()): Promise<number> {
  const { meta } = await db
    .delete(emailDomainChecks)
    .where(lt(emailDomainChecks.checkedAt, now - RETENTION_MS));
  return meta.changes;
}
