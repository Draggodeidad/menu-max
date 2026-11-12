import { describe, expect, it } from "vitest";
import { hashToken, newId, newPublicToken } from "./ids";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

describe("newId", () => {
  it("genera UUIDv7 válidos", () => {
    for (let i = 0; i < 100; i++) expect(newId()).toMatch(UUID_V7);
  });

  it("codifica el tiempo actual en los primeros 48 bits", () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    const ms = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it("es ordenable por momento de creación", async () => {
    const first = newId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = newId();
    expect(first < second).toBe(true);
  });

  it("no repite ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });
});

describe("newPublicToken", () => {
  it("tiene 43 caracteres base64url", () => {
    for (let i = 0; i < 100; i++) expect(newPublicToken()).toMatch(BASE64URL_43);
  });

  it("no repite tokens", () => {
    expect(newPublicToken()).not.toBe(newPublicToken());
  });
});

describe("hashToken", () => {
  it("es determinista y devuelve SHA-256 en base64url", async () => {
    const token = newPublicToken();
    const hash = await hashToken(token);
    expect(await hashToken(token)).toBe(hash);
    expect(hash).toMatch(BASE64URL_43);
    expect(hash).not.toBe(token);
  });

  it("coincide con el vector conocido de SHA-256", async () => {
    // SHA-256("abc") = ba7816bf...15ad
    expect(await hashToken("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });
});
