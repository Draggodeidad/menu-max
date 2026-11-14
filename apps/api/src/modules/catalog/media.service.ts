import {
  MAX_MEDIA_SIDE,
  MEDIA_CONTENT_TYPES,
  MEDIA_UPLOADS_PER_HOUR,
  type MediaAssetDto,
} from "@menu-max/contracts";
import type { Env } from "../../env";
import type { Db } from "../../infrastructure/db";
import { deleteObject, publicUrl, putObject } from "../../infrastructure/storage";
import { AppError } from "../../shared/errors";
import { newId } from "../../shared/ids";
import { log } from "../../shared/log";
import { hit } from "../../shared/rate-counters";
import type { TenantContext } from "../../types";
import { guardFailure } from "./catalog.repository";
import { sniffImage } from "./image-header";
import { assetInUse, findActiveAsset, insertMediaAsset, softDeleteAsset } from "./media.repository";

// Subidas de imágenes a R2 (T17). El tipo real sale de los primeros bytes; el `content-type`
// declarado solo filtra lo que claramente no es una imagen admitida.

export type MediaDeps = {
  db: Db;
  env: Pick<Env, "MEDIA" | "MEDIA_PUBLIC_BASE_URL">;
  tenant: TenantContext;
  requestId: string;
  waitUntil: (promise: Promise<unknown>) => void;
};

const HOUR_MS = 60 * 60 * 1000;

export const UNSUPPORTED_IMAGE = "Sube una imagen JPG, PNG o WebP.";
export const IMAGE_TOO_LARGE = `La imagen mide más de ${MAX_MEDIA_SIDE} px por lado. Redúcela e inténtalo de nuevo.`;
export const IMAGE_IN_USE =
  "Esta imagen la usa un producto. Quítala del producto antes de borrarla.";

function invalidImage(message: string) {
  return new AppError("VALIDATION_FAILED", message, { file: [message] });
}

/** `image/jpeg; charset=…` → `image/jpeg`. */
function mediaType(contentType: string | undefined) {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isDeclaredImage(contentType: string | undefined) {
  return (MEDIA_CONTENT_TYPES as readonly string[]).includes(mediaType(contentType));
}

/**
 * Valida y guarda una imagen. El cuerpo ya llega acotado a 5 MB por el `bodyLimit` de la ruta.
 * Solo una imagen válida gasta el cupo de subidas de la organización.
 */
export async function uploadMedia(
  deps: MediaDeps,
  declaredType: string | undefined,
  readBody: () => Promise<ArrayBuffer>,
): Promise<MediaAssetDto> {
  if (!isDeclaredImage(declaredType)) throw invalidImage(UNSUPPORTED_IMAGE);
  const bytes = new Uint8Array(await readBody());
  const image = sniffImage(bytes);
  if (!image || image.width === 0 || image.height === 0) throw invalidImage(UNSUPPORTED_IMAGE);
  if (image.width > MAX_MEDIA_SIDE || image.height > MAX_MEDIA_SIDE) {
    throw invalidImage(IMAGE_TOO_LARGE);
  }

  const orgId = deps.tenant.orgId;
  const quota = await hit(deps.db, `media:${orgId}`, HOUR_MS, MEDIA_UPLOADS_PER_HOUR);
  if (!quota.allowed) {
    log.warn("media.quota_exceeded", { requestId: deps.requestId, orgId });
    throw new AppError(
      "RATE_LIMITED",
      `Ya subiste ${MEDIA_UPLOADS_PER_HOUR} imágenes en esta hora. Espera un momento y vuelve a intentarlo.`,
      undefined,
      quota.retryAfterMs / 1000,
    );
  }

  // La llave nunca lleva el nombre original: solo el tenant, un id nuevo y la extensión real.
  const id = newId();
  const key = `org/${orgId}/media/${id}.${image.ext}`;
  await putObject(deps.env, key, bytes, image.contentType);
  try {
    await insertMediaAsset(deps.db, deps.tenant, {
      id,
      key,
      contentType: image.contentType,
      sizeBytes: bytes.byteLength,
      width: image.width,
      height: image.height,
      createdByMemberId: deps.tenant.memberId,
    });
  } catch (error) {
    // Sin fila en D1 nadie puede usar el objeto: se borra después de responder.
    deps.waitUntil(
      deleteObject(deps.env, key).catch(() =>
        log.warn("media.orphan_cleanup_failed", { requestId: deps.requestId, orgId, mediaId: id }),
      ),
    );
    throw error;
  }

  log.info("media.uploaded", {
    requestId: deps.requestId,
    orgId,
    mediaId: id,
    contentType: image.contentType,
    sizeBytes: bytes.byteLength,
  });
  return { id, url: publicUrl(deps.env, key), width: image.width, height: image.height };
}

/** Borrado lógico; la imagen que usa un producto activo no se borra (`BUSINESS_RULE`). */
export async function deleteMedia(deps: MediaDeps, mediaId: string, now = new Date()) {
  if (!(await findActiveAsset(deps.db, deps.tenant, mediaId))) throw new AppError("NOT_FOUND");
  const inUse = new AppError("BUSINESS_RULE", IMAGE_IN_USE);
  if (await assetInUse(deps.db, deps.tenant, mediaId)) throw inUse;
  try {
    await softDeleteAsset(deps.db, deps.tenant, mediaId, now);
  } catch (error) {
    throw guardFailure(error) === "asset_in_use" ? inUse : error;
  }
  log.info("media.deleted", { requestId: deps.requestId, orgId: deps.tenant.orgId, mediaId });
}
