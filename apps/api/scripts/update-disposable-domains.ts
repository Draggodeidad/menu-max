// Regenera `src/shared/disposable-domains.ts` (ADR-008). Ejecútalo a mano desde `apps/api`:
//
//   node scripts/update-disposable-domains.ts
//
// Fuente: lista comunitaria `disposable-email-domains/disposable-email-domains` (licencia CC0),
// archivo `disposable_email_blocklist.conf`: un dominio por línea, en minúsculas.
// https://github.com/disposable-email-domains/disposable-email-domains
// Revisa el diff antes de commitear: un dominio legítimo en la lista bloquearía registros reales.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const SOURCE =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const TARGET = new URL("../src/shared/disposable-domains.ts", import.meta.url);
const DOMAIN = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d-]{2,63}$/;

const response = await fetch(SOURCE, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`La fuente respondió HTTP ${response.status}.`);

const domains = [
  ...new Set(
    (await response.text())
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line !== "" && !line.startsWith("#")),
  ),
].toSorted();

const invalid = domains.filter((domain) => !DOMAIN.test(domain));
if (invalid.length > 0) throw new Error(`Hay ${invalid.length} líneas que no son dominios.`);
if (domains.length < 1000)
  throw new Error(`La lista es sospechosamente corta (${domains.length}).`);

const source = `// Generado por scripts/update-disposable-domains.ts. No lo edites a mano.
// Fuente: https://github.com/disposable-email-domains/disposable-email-domains (CC0).

/** Dominios de correo desechable (ADR-008). Se comparan también sus subdominios. */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set(${JSON.stringify(domains)});
`;

await writeFile(TARGET, source);
execFileSync("pnpm", ["-w", "exec", "oxfmt", TARGET.pathname], { stdio: "inherit" });
console.log(`Escribí ${domains.length} dominios en ${TARGET.pathname}.`);
