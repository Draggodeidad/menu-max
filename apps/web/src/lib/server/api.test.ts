import { isHttpError, type Cookies } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn<Fetcher["fetch"]>() }));

vi.mock("cloudflare:workers", () => ({
  env: { API: { fetch: fetchApi }, INTERNAL_TOKEN: "token-ficticio-para-pruebas-locales" },
}));

function requestEvent(headers?: HeadersInit, address = "192.0.2.12") {
  return {
    request: new Request("https://menusmax.example/app", { headers }),
    getClientAddress: () => address,
    cookies: {
      get: vi.fn<Cookies["get"]>(),
      getAll: vi.fn<Cookies["getAll"]>(),
      set: vi.fn<Cookies["set"]>(),
      delete: vi.fn<Cookies["delete"]>(),
      parse: vi.fn<Cookies["parse"]>(),
      serialize: vi.fn<Cookies["serialize"]>(),
    },
  };
}

describe("cliente de la API", () => {
  beforeEach(() => {
    fetchApi.mockReset();
  });

  it("reenvía el contexto de la petición y conserva el método, el cuerpo y los encabezados propios", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const event = requestEvent({
      "x-request-id": id,
      "x-mm-internal": "token-falso",
      "x-client-ip": "203.0.113.10",
      "user-agent": "Navegador de prueba",
      origin: "https://menusmax.example",
      cookie: "sesion=abc",
    });
    const body = JSON.stringify({ name: "Tacos El Güero" });
    const response = Response.json({ ok: true });
    fetchApi.mockResolvedValue(response);

    await expect(
      api(event, "/v1/health?local=1", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-mm-internal": "otro-token-falso",
          "x-client-ip": "203.0.113.20",
          cookie: "sesion=falsa",
        },
        redirect: "follow",
      }),
    ).resolves.toBe(response);

    expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
      new URL("https://api.internal/v1/health?local=1"),
      {
        method: "POST",
        body,
        headers: new Headers({
          "content-type": "application/json",
          "x-mm-internal": "token-ficticio-para-pruebas-locales",
          "x-request-id": id,
          "x-client-ip": "192.0.2.12",
          "user-agent": "Navegador de prueba",
          origin: "https://menusmax.example",
          cookie: "sesion=abc",
        }),
        redirect: "manual",
      },
    );
  });

  it("genera un identificador y omite el contexto ausente en la petición original", async () => {
    fetchApi.mockResolvedValue(Response.json({ ok: true }));

    await api(requestEvent(undefined, ""), "/v1/health", {
      headers: { cookie: "sesion=falsa", origin: "https://otro.example", "x-client-ip": "falsa" },
    });

    const headers = new Headers(fetchApi.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("origin")).toBe(false);
    expect(headers.has("x-client-ip")).toBe(false);
  });

  it("reenvía cada cookie al host de WEB y conserva sus atributos y expiración", async () => {
    const event = requestEvent();
    const response = Response.json({ ok: true });
    const session = "sesion=abc; Domain=api.internal; Path=/; HttpOnly; Secure; SameSite=Lax";
    const expired = "anterior=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0";
    const expires = new Date(0);
    response.headers.append("set-cookie", session);
    response.headers.append("set-cookie", expired);
    fetchApi.mockResolvedValue(response);
    event.cookies.parse
      .mockReturnValueOnce({
        name: "sesion",
        value: "abc",
        domain: "api.internal",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      })
      .mockReturnValueOnce({ name: "anterior", value: "", path: "/", expires, maxAge: 0 });

    await api(event, "/v1/health");

    expect(event.cookies.parse.mock.calls).toEqual([[session], [expired]]);
    expect(event.cookies.set.mock.calls).toEqual([
      ["sesion", "abc", { path: "/", httpOnly: true, secure: true, sameSite: "lax" }],
      ["anterior", "", { path: "/", expires, maxAge: 0 }],
    ]);
  });

  it("traduce el error del contrato a HttpError con su código, mensaje y estado", async () => {
    const message = "Inicia sesión para continuar.";
    fetchApi.mockResolvedValue(
      Response.json({ code: "AUTH_REQUIRED", message, requestId: "prueba" }, { status: 401 }),
    );

    const result = await api(requestEvent(), "/v1/health").catch((cause: unknown) => cause);

    expect(isHttpError(result, 401)).toBe(true);
    expect(result).toMatchObject({ status: 401, body: { code: "AUTH_REQUIRED", message } });
  });

  it("devuelve un error de comunicación si la respuesta no cumple el contrato", async () => {
    fetchApi.mockResolvedValue(new Response("Detalle interno", { status: 500 }));

    await expect(api(requestEvent(), "/v1/health")).rejects.toMatchObject({
      status: 502,
      body: {
        code: "INTERNAL",
        message: "No pudimos comunicarnos con el servicio. Inténtalo de nuevo.",
      },
    });
  });

  it("devuelve un error de comunicación si falla el binding", async () => {
    fetchApi.mockRejectedValue(new Error("Binding sin conexión"));

    await expect(api(requestEvent(), "/v1/health")).rejects.toMatchObject({
      status: 502,
      body: { code: "INTERNAL" },
    });
  });

  it.each(["https://otro.example", "//otro.example", "/\\otro.example"])(
    "rechaza la ruta fuera de la API %s antes de enviar credenciales",
    async (path) => {
      await expect(api(requestEvent(), path)).rejects.toThrow(TypeError);
      expect(fetchApi).not.toHaveBeenCalled();
    },
  );
});
