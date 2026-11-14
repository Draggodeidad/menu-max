import { z } from "zod";

// Imágenes del panel en R2 (T17). El tipo real se decide por los primeros bytes del archivo, no
// por el `content-type` declarado. Sin redimensionar ni convertir: el archivo se guarda tal cual.

export const MEDIA_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MediaContentType = z.enum(MEDIA_CONTENT_TYPES);
export type MediaContentType = z.infer<typeof MediaContentType>;

/** Tamaño máximo de una subida: 5 MB. Sustituye al límite de 64 KB solo en `POST /media`. */
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
/** Lado máximo en píxeles, leído de la cabecera del archivo. */
export const MAX_MEDIA_SIDE = 6000;
/** Cuota provisional de subidas por organización y hora (ADR-010, `rate_counters`). */
export const MEDIA_UPLOADS_PER_HOUR = 60;

export const MediaParams = z.strictObject({ mediaId: z.uuidv7() });

/** Imagen subida. `url` ya apunta al dominio público del bucket; el frontend no arma rutas. */
export const MediaAssetDto = z
  .strictObject({
    id: z.uuidv7(),
    url: z.url(),
    width: z.int().positive(),
    height: z.int().positive(),
  })
  .meta({ id: "MediaAssetDto" });
export type MediaAssetDto = z.infer<typeof MediaAssetDto>;
