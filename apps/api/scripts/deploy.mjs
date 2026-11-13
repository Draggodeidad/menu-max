import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_readRawConfig } from "wrangler";

const root = new URL("../../../", import.meta.url);
const {
  DEPLOY_ENVIRONMENT: environment,
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_DATABASE_ID: databaseId,
  CLOUDFLARE_API_TOKEN: apiToken,
  WEB_ORIGIN: webOrigin,
  EMAIL_FROM: emailFrom,
  BETTER_AUTH_SECRET: authSecret,
  INTERNAL_TOKEN: internalToken,
  RESEND_API_KEY: resendApiKey,
  ...childEnv
} = process.env;

if (childEnv.GITHUB_ACTIONS !== "true" || childEnv.GITHUB_REF !== "refs/heads/main") {
  throw new Error("La publicación remota se ejecuta desde main en GitHub Actions.");
}
if (environment !== "staging" && environment !== "production") {
  throw new Error("Selecciona staging o production.");
}
if (!accountId || !/^[a-f\d]{32}$/i.test(accountId) || !apiToken?.trim()) {
  throw new Error("Configura CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN en GitHub Actions.");
}
if (
  !databaseId ||
  !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(databaseId) ||
  databaseId.startsWith("00000000-0000-0000-0000-")
) {
  throw new Error("Configura el UUID real de D1 en CLOUDFLARE_DATABASE_ID.");
}
const origin = webOrigin && URL.parse(webOrigin);
if (!origin || origin.protocol !== "https:" || origin.origin !== webOrigin || origin.port) {
  throw new Error("Configura WEB_ORIGIN con el origen HTTPS de WEB, sin ruta ni puerto.");
}
const sender = emailFrom?.trim().match(/<([^<>\s]+)>$/)?.[1] ?? emailFrom?.trim();
if (
  !sender ||
  !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(sender) ||
  /@example\.(com|org|net)$/i.test(sender)
) {
  throw new Error("Configura EMAIL_FROM con el remitente real dado de alta en Resend.");
}
if (
  !authSecret ||
  authSecret.length < 32 ||
  !internalToken ||
  internalToken.length < 32 ||
  authSecret === internalToken
) {
  throw new Error(
    "Configura BETTER_AUTH_SECRET e INTERNAL_TOKEN con valores distintos de al menos 32 caracteres.",
  );
}
if (!resendApiKey?.startsWith("re_") || /\s/.test(resendApiKey)) {
  throw new Error("Configura RESEND_API_KEY con la API key de Resend del entorno.");
}

function readConfig(app) {
  return experimental_readRawConfig({
    config: fileURLToPath(new URL(`apps/${app}/wrangler.jsonc`, root)),
  }).rawConfig;
}

function writeJson(path, data) {
  return writeFile(path, JSON.stringify(data), { flag: "wx", mode: 0o600 });
}

function wrangler(app, config, args, stdout = "inherit") {
  return execFileSync(
    "pnpm",
    [
      "--filter",
      app,
      "exec",
      "wrangler",
      ...args,
      "--config",
      fileURLToPath(config),
      "--env",
      environment,
    ],
    {
      cwd: root,
      env: {
        ...childEnv,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiToken,
      },
      encoding: "utf8",
      stdio: ["ignore", stdout, "inherit"],
    },
  );
}

const api = readConfig("api");
const web = readConfig("web");
const apiEnvironment = api.env[environment];
const webEnvironment = web.env[environment];
const database = apiEnvironment.d1_databases.find(({ binding }) => binding === "DB");
if (!database?.database_name) throw new Error("Falta el nombre de D1 para el binding DB.");

const usesWorkersDev = origin.hostname.endsWith(".workers.dev");
if (
  usesWorkersDev &&
  !new RegExp(`^${webEnvironment.name}\\.[a-z\\d-]+\\.workers\\.dev$`).test(origin.hostname)
) {
  throw new Error(`WEB_ORIGIN debe corresponder al Worker ${webEnvironment.name}.`);
}
await access(new URL(`apps/web/${web.main}`, root));

apiEnvironment.vars.WEB_ORIGIN = origin.origin;
apiEnvironment.vars.EMAIL_FROM = emailFrom.trim();
apiEnvironment.preview_urls = false;
database.database_id = databaseId.toLowerCase();
webEnvironment.workers_dev = usesWorkersDev;

const secretDirectory = await mkdtemp(join(tmpdir(), "menusmax-release-"));
const configName = `.${basename(secretDirectory)}.json`;
const apiConfig = new URL(`apps/api/${configName}`, root);
const webConfig = new URL(`apps/web/${configName}`, root);
const apiSecrets = join(secretDirectory, "api.json");
const webSecrets = join(secretDirectory, "web.json");

try {
  await writeJson(apiConfig, api);
  await writeJson(webConfig, web);
  await writeJson(apiSecrets, {
    BETTER_AUTH_SECRET: authSecret,
    INTERNAL_TOKEN: internalToken,
    RESEND_API_KEY: resendApiKey,
  });
  await writeJson(webSecrets, { INTERNAL_TOKEN: internalToken });

  const databases = JSON.parse(wrangler("api", apiConfig, ["d1", "list", "--json"], "pipe"));
  const exists = databases.some(
    ({ uuid, name }) => uuid === database.database_id && name === database.database_name,
  );
  if (!exists) throw new Error(`El UUID indicado no corresponde a ${database.database_name}.`);

  wrangler("api", apiConfig, ["d1", "migrations", "apply", "DB", "--remote"]);
  wrangler("api", apiConfig, ["deploy", "--secrets-file", apiSecrets]);
  wrangler("web", webConfig, ["deploy", "--secrets-file", webSecrets]);
} finally {
  await Promise.all([
    rm(apiConfig, { force: true }),
    rm(webConfig, { force: true }),
    rm(secretDirectory, { recursive: true, force: true }),
  ]);
}
