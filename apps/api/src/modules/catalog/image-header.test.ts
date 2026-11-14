import { describe, expect, it } from "vitest";
import { jpegBytes, pngBytes, webpBytes } from "../../../test/factories";
import { sniffImage } from "./image-header";

describe("sniffImage", () => {
  it.each([
    ["JPEG baseline", jpegBytes(1200, 800), "image/jpeg", "jpg", 1200, 800],
    ["JPEG progresivo", jpegBytes(640, 480, 0xc2), "image/jpeg", "jpg", 640, 480],
    ["PNG", pngBytes(1024, 768), "image/png", "png", 1024, 768],
    ["WebP lossy (VP8)", webpBytes(800, 600, "VP8 "), "image/webp", "webp", 800, 600],
    ["WebP lossless (VP8L)", webpBytes(16_383, 1, "VP8L"), "image/webp", "webp", 16_383, 1],
    ["WebP extendido (VP8X)", webpBytes(6000, 4000, "VP8X"), "image/webp", "webp", 6000, 4000],
  ] as const)("%s → tipo, extensión y dimensiones", (_, bytes, contentType, ext, width, height) => {
    expect(sniffImage(bytes)).toEqual({ contentType, ext, width, height });
  });

  it("salta bytes de relleno 0xFF y marcadores sin longitud antes del SOF", () => {
    const base = jpegBytes(300, 200);
    // SOI, relleno, RST0 y luego el resto (APP0, SOF, …).
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xd0, ...base.slice(2)]);
    expect(sniffImage(bytes)).toMatchObject({ width: 300, height: 200 });
  });

  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
  const gif = new Uint8Array([...new TextEncoder().encode("GIF89a"), 1, 0, 1, 0, 0, 0, 0]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const riffWave = new TextEncoder().encode("RIFF$\u0000\u0000\u0000WAVEfmt ");
  const jpegWithoutSof = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]);

  it.each([
    ["vacío", new Uint8Array()],
    [".exe (MZ)", exe],
    ["GIF", gif],
    ["SVG", svg],
    ["RIFF que no es WebP", riffWave],
    ["JPEG sin SOF antes de los datos", jpegWithoutSof],
    ["JPEG truncado", jpegBytes(100, 100).slice(0, 25)],
    ["PNG truncado", pngBytes(100, 100).slice(0, 20)],
    ["PNG sin IHDR", new Uint8Array([...pngBytes(1, 1).slice(0, 12), 0x49, 0x44, 0x41, 0x54])],
    ["WebP truncado", webpBytes(100, 100).slice(0, 26)],
    ["WebP VP8 sin código de inicio", webpBytes(100, 100).map((b, i) => (i === 23 ? 0 : b))],
  ])("%s → null", (_, bytes) => {
    expect(sniffImage(bytes)).toBeNull();
  });
});
