import type { MediaContentType } from "@menu-max/contracts";

// Tipo real y dimensiones de una imagen a partir de sus primeros bytes (_magic bytes_), sin
// decodificarla (T17). El `content-type` declarado no se toma en cuenta.

export type ImageHeader = {
  contentType: MediaContentType;
  ext: "jpg" | "png" | "webp";
  width: number;
  height: number;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  return (
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte)
  );
}

function ascii(bytes: Uint8Array, offset: number, text: string) {
  return startsWith(
    bytes,
    [...text].map((char) => char.charCodeAt(0)),
    offset,
  );
}

/** Lector acotado: fuera de rango lanza y `sniffImage` lo trata como archivo inválido. */
function reader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    u8: (offset: number) => view.getUint8(offset),
    u16be: (offset: number) => view.getUint16(offset, false),
    u16le: (offset: number) => view.getUint16(offset, true),
    u32be: (offset: number) => view.getUint32(offset, false),
    u32le: (offset: number) => view.getUint32(offset, true),
    u24le: (offset: number) =>
      view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16),
  };
}

type Read = ReturnType<typeof reader>;

// SOF0–SOF15 llevan las dimensiones; C4 (DHT), C8 (JPG) y CC (DAC) no son SOF.
function isStartOfFrame(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

// Marcadores sin longitud: TEM y RST0–RST7.
function isStandalone(marker: number) {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function jpegSize(bytes: Uint8Array, read: Read) {
  let offset = 2;
  while (offset < bytes.length) {
    if (read.u8(offset) !== 0xff) return null;
    // Bytes de relleno 0xFF antes del marcador.
    while (read.u8(offset + 1) === 0xff) offset += 1;
    const marker = read.u8(offset + 1);
    if (isStandalone(marker)) {
      offset += 2;
      continue;
    }
    // Inicio de los datos o fin de la imagen sin haber visto un SOF.
    if (marker === 0xda || marker === 0xd9 || marker === 0xd8) return null;
    const length = read.u16be(offset + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      return { height: read.u16be(offset + 5), width: read.u16be(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function pngSize(bytes: Uint8Array, read: Read) {
  if (!ascii(bytes, 12, "IHDR")) return null;
  return { width: read.u32be(16), height: read.u32be(20) };
}

function webpSize(bytes: Uint8Array, read: Read) {
  if (ascii(bytes, 12, "VP8 ")) {
    // Fotograma clave: 3 bytes de etiqueta, código de inicio 9D 01 2A y tamaños de 14 bits.
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null;
    return { width: read.u16le(26) & 0x3fff, height: read.u16le(28) & 0x3fff };
  }
  if (ascii(bytes, 12, "VP8L")) {
    if (read.u8(20) !== 0x2f) return null;
    const bits = read.u32le(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(bytes, 12, "VP8X")) {
    return { width: read.u24le(24) + 1, height: read.u24le(27) + 1 };
  }
  return null;
}

function detect(bytes: Uint8Array): ImageHeader | null {
  const read = reader(bytes);
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    const size = jpegSize(bytes, read);
    return size && { contentType: "image/jpeg", ext: "jpg", ...size };
  }
  if (startsWith(bytes, PNG_SIGNATURE)) {
    const size = pngSize(bytes, read);
    return size && { contentType: "image/png", ext: "png", ...size };
  }
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    const size = webpSize(bytes, read);
    return size && { contentType: "image/webp", ext: "webp", ...size };
  }
  return null;
}

/** JPEG, PNG o WebP con sus dimensiones; `null` si es otro formato o viene truncado. */
export function sniffImage(bytes: Uint8Array): ImageHeader | null {
  try {
    return detect(bytes);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
