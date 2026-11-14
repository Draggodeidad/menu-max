import {
  ErrorResponse,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_SIDE,
  MEDIA_CONTENT_TYPES,
  MEDIA_UPLOADS_PER_HOUR,
  MediaAssetDto,
  MediaParams,
} from "@menu-max/contracts";
import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { createDb } from "../../infrastructure/db";
import { requirePermission } from "../../middleware/authz";
import type { TenantEnv } from "../../types";
import { forbidden, invalidInput, privateSecurity } from "../businesses/businesses.routes";
import {
  jsonResponse,
  orgIdParameter,
  orgScopedResponses,
  routeParam,
} from "../organizations/organizations.routes";
import { deleteMedia, uploadMedia, type MediaDeps } from "./media.service";

function deps(c: Context<TenantEnv>): MediaDeps {
  return {
    db: createDb(c.env),
    env: c.env,
    tenant: c.var.tenant,
    requestId: c.var.requestId,
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  };
}

const tags = ["Imágenes"];
const binaryImage = { schema: { type: "string", format: "binary" } } as const;
const mediaNotFound = jsonResponse(
  "La organización o la imagen no existen (o la imagen ya se borró).",
  ErrorResponse,
);

// Se monta en `orgScoped` (`/v1/orgs/:orgId/media`), que ya aplicó `requireAuth`,
// `requireMembership()` y `requireOperable()`. El límite de cuerpo de 5 MB de `POST /` lo aplica
// `app.ts` en lugar del de 64 KB.
export const mediaRoutes = new Hono<TenantEnv>()
  .post(
    "/",
    describeRoute({
      tags,
      summary: "Subir una imagen",
      description: `Cuerpo binario de hasta ${MAX_MEDIA_BYTES / 1024 / 1024} MB. El tipo real se decide por los primeros bytes del archivo (JPEG, PNG o WebP), no por el \`content-type\`; el ancho y el alto se leen de la cabecera y no pueden pasar de ${MAX_MEDIA_SIDE} px por lado. Hasta ${MEDIA_UPLOADS_PER_HOUR} subidas por hora por organización. Para usarla en un producto, envía su \`id\` como \`imageAssetId\` en \`PATCH …/menu/products/:productId\`.`,
      security: privateSecurity,
      parameters: [orgIdParameter],
      requestBody: {
        required: true,
        content: Object.fromEntries(MEDIA_CONTENT_TYPES.map((type) => [type, binaryImage])),
      },
      responses: {
        201: jsonResponse("Imagen subida, con su URL pública y dimensiones.", MediaAssetDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        413: jsonResponse("La imagen pesa más de 5 MB.", ErrorResponse),
        429: jsonResponse(
          "Demasiadas peticiones desde esta IP o se agotó el cupo de subidas de la hora. Espera los segundos del header Retry-After.",
          ErrorResponse,
        ),
      },
    }),
    requirePermission("catalog:write"),
    async (c) =>
      c.json(
        await uploadMedia(deps(c), c.req.header("content-type"), () => c.req.arrayBuffer()),
        201,
      ),
  )
  .delete(
    "/:mediaId",
    describeRoute({
      tags,
      summary: "Borrar una imagen",
      description:
        "Borrado lógico. Una imagen que usa un producto activo no se puede borrar: primero quítala del producto.",
      security: privateSecurity,
      parameters: [
        orgIdParameter,
        {
          name: "mediaId",
          in: "path",
          required: true,
          description: "Id (UUIDv7) de la imagen.",
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        204: { description: "Imagen borrada." },
        403: forbidden,
        ...orgScopedResponses,
        404: mediaNotFound,
        422: jsonResponse("Un producto activo usa la imagen.", ErrorResponse),
      },
    }),
    requirePermission("catalog:write"),
    async (c) => {
      await deleteMedia(deps(c), routeParam(MediaParams, "mediaId", c.req.param("mediaId")));
      return c.body(null, 204);
    },
  );
