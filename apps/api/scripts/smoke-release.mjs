// Prueba de humo de la API sobre el entorno creado por `prepare-release.mjs`.
// Levanta el Worker en local, comprueba sus controles básicos y siempre lo detiene.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const STARTUP_TIMEOUT_MS = 60_000;
const root = new URL("../../../", import.meta.url);
const apiDirectory = fileURLToPath(new URL("apps/api/", root));
const stateDirectory = new URL("apps/api/.wrangler/release/", root);
const statePath = fileURLToPath(stateDirectory);
const varsPath = fileURLToPath(new URL("release.vars", stateDirectory));

async function readInternalToken() {
  const vars = await readFile(varsPath, "utf8").catch(() => {
    throw new Error("Primero ejecuta: pnpm --filter api release:prepare");
  });
  const encoded = vars.match(/^INTERNAL_TOKEN=(.+)$/m)?.[1];
  if (!encoded) throw new Error("El entorno de liberación no tiene INTERNAL_TOKEN.");
  return JSON.parse(encoded);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startWorker(port) {
  return spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      statePath,
      "--env-file",
      varsPath,
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: apiDirectory,
      detached: true,
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
}

async function waitUntilReady(baseUrl, worker, deadline = Date.now() + STARTUP_TIMEOUT_MS) {
  if (Date.now() >= deadline) throw new Error("El Worker no respondió dentro del tiempo límite.");
  if (worker.exitCode !== null) throw new Error("Wrangler terminó antes de quedar listo.");
  try {
    await fetch(`${baseUrl}/v1/health`, { signal: AbortSignal.timeout(2_000) });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await waitUntilReady(baseUrl, worker, deadline);
  }
}

function stopWorker(worker) {
  if (worker.exitCode !== null || worker.pid === undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const forceStop = setTimeout(() => process.kill(-worker.pid, "SIGKILL"), 5_000);
    worker.once("exit", () => {
      clearTimeout(forceStop);
      resolve();
    });
    process.kill(-worker.pid, "SIGTERM");
  });
}

async function verify(baseUrl, token) {
  const health = `${baseUrl}/v1/health`;
  const checks = [
    {
      name: "Sin token interno responde 404 sin cuerpo",
      request: () => fetch(health),
      expect: async (response) => response.status === 404 && (await response.text()) === "",
    },
    {
      name: "Con token incorrecto responde 404",
      request: () => fetch(health, { headers: { "x-mm-internal": "x".repeat(64) } }),
      expect: async (response) => response.status === 404,
    },
    {
      name: "Con token válido reporta API y D1 en buen estado",
      request: () => fetch(health, { headers: { "x-mm-internal": token } }),
      expect: async (response) => {
        if (response.status !== 200) return false;
        const body = await response.json();
        return body.status === "ok" && body.db === "ok";
      },
    },
    {
      name: "Una ruta inexistente responde 404",
      request: () =>
        fetch(`${baseUrl}/v1/ruta-inexistente`, { headers: { "x-mm-internal": token } }),
      expect: async (response) => response.status === 404,
    },
  ];

  const results = await Promise.all(
    checks.map(async ({ name, request, expect }) => {
      const response = await request();
      return { name, status: response.status, passed: await expect(response) };
    }),
  );
  for (const { name, status, passed } of results) {
    console.log(`${passed ? "PASA" : "FALLA"}  ${name} (HTTP ${status})`);
  }
  return { total: checks.length, failed: results.filter(({ passed }) => !passed).length };
}

const token = await readInternalToken();
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const worker = startWorker(port);

try {
  await waitUntilReady(baseUrl, worker);
  const { total, failed } = await verify(baseUrl, token);
  console.log(`\n${total - failed} de ${total} comprobaciones pasaron`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await stopWorker(worker);
}
