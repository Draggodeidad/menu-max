// Prepara un entorno de liberación local y desechable en `.wrangler/release`.
// No usa `.dev.vars`, no contacta Cloudflare y no publica nada.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { experimental_readRawConfig } from "wrangler";

const root = new URL("../../../", import.meta.url);
const apiDirectory = fileURLToPath(new URL("apps/api/", root));
const stateDirectory = new URL("apps/api/.wrangler/release/", root);
const statePath = fileURLToPath(stateDirectory);
const varsPath = fileURLToPath(new URL("release.vars", stateDirectory));

const randomSecret = () => randomBytes(32).toString("hex");
const releaseVars = {
  INTERNAL_TOKEN: randomSecret(),
  BETTER_AUTH_SECRET: randomSecret(),
  WEB_ORIGIN: "http://127.0.0.1:4179",
  EMAIL_FROM: "MenusMax <no-responder@menusmax.test>",
  RESEND_API_KEY: `re_${randomSecret()}`,
  // Clave pública de prueba de Cloudflare: siempre aprueba y no protege nada.
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  PHONE_HASH_SALT: randomSecret(),
  ORDER_TOKEN_SECRET: randomSecret(),
  MEDIA_PUBLIC_BASE_URL: "http://127.0.0.1:4179/media",
};

function step(message) {
  console.log(`\n> ${message}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit", ...options });
}

function assertRuntime(manifest) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24 || major >= 27) {
    throw new Error(`Node ${process.versions.node} no cumple ${manifest.engines.node}.`);
  }
  const expected = manifest.packageManager.replace("pnpm@", "");
  const actual = run("pnpm", ["--version"], { stdio: "pipe" }).trim();
  if (actual !== expected) throw new Error(`Se esperaba pnpm ${expected} y se encontró ${actual}.`);
  console.log(`Node ${process.versions.node} y pnpm ${actual}`);
}

async function assertVarsMatchExample() {
  const example = await readFile(new URL("apps/api/.dev.vars.example", root), "utf8");
  const expected = new Set(example.match(/^[A-Z][A-Z\d_]*(?==)/gm));
  const missing = [...expected].filter((name) => !(name in releaseVars));
  const extra = Object.keys(releaseVars).filter((name) => !expected.has(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Las variables no coinciden con .dev.vars.example. Faltan: ${missing.join(", ") || "ninguna"}. Sobran: ${extra.join(", ") || "ninguna"}.`,
    );
  }
  console.log(`${expected.size} variables coinciden con .dev.vars.example`);
}

function bindingNames(config) {
  return [
    ...(config.d1_databases ?? []).map(({ binding }) => `d1:${binding}`),
    ...(config.r2_buckets ?? []).map(({ binding }) => `r2:${binding}`),
    ...(config.ratelimits ?? []).map(({ name }) => `ratelimit:${name}`),
    ...(config.queues?.producers ?? []).map(({ binding }) => `queue:${binding}`),
  ]
    .toSorted()
    .join(",");
}

function assertEnvironmentParity() {
  const { rawConfig } = experimental_readRawConfig({
    config: fileURLToPath(new URL("apps/api/wrangler.jsonc", root)),
  });
  const expected = bindingNames(rawConfig);
  for (const environment of ["staging", "production"]) {
    const config = rawConfig.env?.[environment];
    if (!config) throw new Error(`Falta el entorno ${environment} en wrangler.jsonc.`);
    if (bindingNames(config) !== expected) {
      throw new Error(`Los bindings de ${environment} difieren de los de desarrollo.`);
    }
    if (config.workers_dev !== false) {
      throw new Error(`La API de ${environment} debe permanecer privada (workers_dev: false).`);
    }
  }
  console.log("Desarrollo, staging y production declaran los mismos bindings");
}

async function assertMigrationsApplied() {
  const files = await readdir(new URL("packages/database/migrations/", root));
  const expected = files.filter((file) => file.endsWith(".sql")).length;
  const output = run(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      statePath,
      "--json",
      "--command",
      "SELECT COUNT(*) AS total FROM d1_migrations",
    ],
    { cwd: apiDirectory, stdio: ["ignore", "pipe", "inherit"] },
  );
  const applied = JSON.parse(output)[0].results[0].total;
  if (applied !== expected) {
    throw new Error(`Se aplicaron ${applied} de ${expected} migraciones.`);
  }
  console.log(`${applied} de ${expected} migraciones aplicadas`);
}

const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

step("Comprobando versiones de Node y pnpm");
assertRuntime(manifest);

step("Instalando dependencias con el lockfile congelado");
run("pnpm", ["install", "--frozen-lockfile"]);

step("Comprobando variables y bindings");
await assertVarsMatchExample();
assertEnvironmentParity();

step("Creando el estado local desechable");
await rm(statePath, { recursive: true, force: true });
await mkdir(statePath, { recursive: true });
await writeFile(
  varsPath,
  `${Object.entries(releaseVars)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join("\n")}\n`,
  { flag: "wx", mode: 0o600 },
);

step("Aplicando las migraciones a D1 local");
run(
  "pnpm",
  ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", statePath],
  { cwd: apiDirectory, env: { ...process.env, CI: "true" } },
);
await assertMigrationsApplied();

console.log("\nEntorno de liberación listo. Siguiente paso: pnpm --filter api release:smoke");
