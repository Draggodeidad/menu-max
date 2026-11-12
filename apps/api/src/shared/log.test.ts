import { describe, expect, it, vi } from "vitest";
import { log, redact } from "./log";

describe("redact", () => {
  it("enmascara correos y teléfonos en texto", () => {
    expect(redact("Contacto: alicia@example.com o +52 (55) 0000 1234")).toBe(
      "Contacto: a***@example.com o ***1234",
    );
    expect(redact("+525500001234")).toBe("***1234");
  });

  it("oculta llaves sensibles dentro de objetos y arreglos", () => {
    expect(
      redact({
        password: "clave-ficticia",
        nested: [
          {
            resetToken: "token-ficticio",
            Cookie: "sesión-ficticia",
            authorization: "credencial-ficticia",
            delivery_address: "domicilio ficticio",
            "x-mm-internal": "token-interno-ficticio",
            label: "se conserva",
          },
        ],
      }),
    ).toEqual({
      password: "[REDACTADO]",
      nested: [
        {
          resetToken: "[REDACTADO]",
          Cookie: "[REDACTADO]",
          authorization: "[REDACTADO]",
          delivery_address: "[REDACTADO]",
          "x-mm-internal": "[REDACTADO]",
          label: "se conserva",
        },
      ],
    });
  });

  it("mantiene los UUID y evita bucles con referencias circulares", () => {
    const requestId = "01968009-0000-7000-8000-000000000001";
    const data = { requestId, nested: {} };
    data.nested = data;
    expect(redact(data)).toEqual({ requestId, nested: "[CIRCULAR]" });
  });
});

describe("log", () => {
  it.each(["info", "warn", "error"] as const)("emite JSON redactado con nivel %s", (level) => {
    const output = vi.spyOn(console, level).mockImplementation(() => {});
    try {
      log[level]("http.test", {
        requestId: "01968009-0000-7000-8000-000000000001",
        orgId: "01968009-0000-7000-8000-000000000002",
        email: "alicia@example.com",
      });
      expect(output).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({
          requestId: "01968009-0000-7000-8000-000000000001",
          orgId: "01968009-0000-7000-8000-000000000002",
          email: "a***@example.com",
          level,
          event: "http.test",
        }),
      );
    } finally {
      output.mockRestore();
    }
  });
});
