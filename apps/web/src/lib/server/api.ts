import { env } from "cloudflare:workers";
import { ErrorResponse } from "@menu-max/contracts";
import { error, type RequestEvent } from "@sveltejs/kit";

const API_ORIGIN = "https://api.internal";

function unavailable(): never {
  error(502, {
    code: "INTERNAL",
    message: "No pudimos comunicarnos con el servicio. Inténtalo de nuevo.",
  });
}

export async function api(
  event: Pick<RequestEvent, "request" | "cookies" | "getClientAddress">,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(path, API_ORIGIN);
  if (!path.startsWith("/") || url.origin !== API_ORIGIN || url.username || url.password) {
    throw new TypeError("La ruta debe pertenecer a la API interna.");
  }

  if (!env.API || !env.INTERNAL_TOKEN) unavailable();

  const incoming = event.request.headers;
  const headers = new Headers(init?.headers);
  headers.set("x-mm-internal", env.INTERNAL_TOKEN);
  headers.set("x-request-id", incoming.get("x-request-id") || crypto.randomUUID());

  const clientIp = event.getClientAddress();
  if (clientIp) headers.set("x-client-ip", clientIp);
  else headers.delete("x-client-ip");

  for (const name of ["user-agent", "origin", "cookie"]) {
    const value = incoming.get(name);
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }

  const response = await env.API.fetch(url, { ...init, headers, redirect: "manual" }).catch(
    unavailable,
  );

  for (const header of response.headers.getSetCookie()) {
    const { name, value, ...options } = event.cookies.parse(header);
    if (!name || value === undefined) continue;

    // Sin Domain, el navegador guarda la cookie en el host de WEB.
    delete options.domain;
    event.cookies.set(name, value, options);
  }

  if (!response.ok) {
    const parsed = ErrorResponse.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success || response.status < 400 || response.status > 599) unavailable();

    const { code, message } = parsed.data;
    error(response.status, { code, message });
  }

  return response;
}
