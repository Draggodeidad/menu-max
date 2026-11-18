import type { Env } from "../env";

// Adaptador de R2 (binding `MEDIA`, T17). Las llaves llevan un id nuevo por objeto, así que el
// contenido de una llave nunca cambia y el CDN puede guardarlo para siempre.

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

type Media = Pick<Env, "MEDIA">;

/** Sube un objeto inmutable con su tipo real. */
export async function putObject(
  env: Media,
  key: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await env.MEDIA.put(key, body, {
    httpMetadata: { contentType, cacheControl: IMMUTABLE_CACHE_CONTROL },
  });
}

export async function deleteObject(env: Media, key: string): Promise<void> {
  await env.MEDIA.delete(key);
}

/** URL pública del objeto en el dominio del bucket. */
export function publicUrl(env: Pick<Env, "MEDIA_PUBLIC_BASE_URL">, key: string): string {
  return `${env.MEDIA_PUBLIC_BASE_URL}/${key}`;
}
