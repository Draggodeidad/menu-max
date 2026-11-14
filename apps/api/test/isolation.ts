// Aislamiento entre tenants (ADR-006): un recurso de otra organización simplemente no existe.
import { ErrorResponse } from "@menu-max/contracts";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { getEnv, type Env } from "../src/env";
import worker from "../src/index";
import type { TestUser } from "./factories";

function randomIp() {
  const [a, b] = crypto.randomUUID().split("-");
  return `2001:db8::${a?.slice(0, 4)}:${b}`;
}

/** Petición a la API completa con token interno, IP propia (evita el rate limit) y sesión. */
export function callApi(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown; headers?: HeadersInit; bindings?: Env } = {},
) {
  const bindings = options.bindings ?? getEnv(env);
  const headers = new Headers(options.headers);
  headers.set("x-mm-internal", bindings.INTERNAL_TOKEN);
  if (!headers.has("x-client-ip")) headers.set("x-client-ip", randomIp());
  if (options.cookie) headers.set("cookie", options.cookie);
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  return worker.fetch(
    new Request(`https://api.internal${path}`, { method, headers, body }),
    bindings,
    createExecutionContext(),
  );
}

/**
 * Llama cada ruta como `intruder` (miembro de la organización B, idealmente `owner`) con ids
 * reales de la organización A y espera `404 NOT_FOUND`, nunca `403` ni datos.
 *
 * Pasa en `paths` las dos variantes que apliquen:
 * - `/v1/orgs/{orgA}/…/{recursoDeA}`: lo frena `requireMembership`;
 * - `/v1/orgs/{orgB}/…/{recursoDeA}`: lo frena el filtro por `organization_id` del repositorio.
 */
export async function expectNotFoundForOtherTenant(options: {
  method?: string;
  paths: string[];
  body?: unknown;
  intruder: TestUser;
}) {
  expect(options.paths.length).toBeGreaterThan(0);
  const method = options.method ?? "GET";
  await Promise.all(
    options.paths.map(async (path) => {
      const response = await callApi(method, path, {
        cookie: options.intruder.cookie,
        body: options.body,
      });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(ErrorResponse.parse(await response.json()).code).toBe("NOT_FOUND");
    }),
  );
}
