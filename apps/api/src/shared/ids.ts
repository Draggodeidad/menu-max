// Ids y tokens públicos (ADR-013). Solo `crypto`; nunca `Math.random()`.

const TOKEN_BYTES = 32;

/** UUIDv7 (RFC 9562): 48 bits de tiempo en ms + 74 bits aleatorios. Ordenable por creación. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = Date.now();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms & 0xff;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // versión 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Token público de 32 bytes en base64url (43 caracteres). Solo se entrega al cliente. */
export function newPublicToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** SHA-256 del token en base64url. Es lo único que se guarda en la base. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

const TRACKING_TOKEN_CONTEXT = "order-tracking:v1:";

/**
 * Token de seguimiento de un pedido (enmienda de ADR-013): `HMAC-SHA256(secreto,
 * "order-tracking:v1:" + orderId)` en base64url, 32 bytes como `newPublicToken`. Es determinista
 * para que un reintento con la misma `Idempotency-Key` devuelva el mismo token sin guardarlo; la
 * base solo guarda su `hashToken`. El prefijo ata el secreto a este uso y `v1` permite rotarlo.
 */
export async function orderTrackingToken(secret: string, orderId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${TRACKING_TOKEN_CONTEXT}${orderId}`),
  );
  return toBase64Url(new Uint8Array(signature));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
