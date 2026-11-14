import {
  BranchParams,
  CategoryDto,
  CategoryParams,
  CreateCategoryInput,
  CreateProductInput,
  ErrorResponse,
  MenuDto,
  ProductAvailabilityInput,
  ProductDto,
  ProductParams,
  ReorderInput,
  ReorderResultDto,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@menu-max/contracts";
import { Hono, type Context } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { createDb } from "../../infrastructure/db";
import { requirePermission } from "../../middleware/authz";
import { requireBranch } from "../../middleware/tenant";
import type { TenantEnv } from "../../types";
import {
  branchIdParameter,
  forbidden,
  invalidInput,
  privateSecurity,
} from "../businesses/businesses.routes";
import {
  jsonResponse,
  orgIdParameter,
  orgScopedResponses,
  rejectWith,
  routeParam,
} from "../organizations/organizations.routes";
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  getMenu,
  reorderCategories,
  reorderProducts,
  setAvailability,
  updateCategory,
  updateProduct,
  type CatalogDeps,
} from "./catalog.service";

function deps(c: Context<TenantEnv>): CatalogDeps {
  return { db: createDb(c.env), tenant: c.var.tenant, requestId: c.var.requestId };
}

function branchId(c: Context<TenantEnv>) {
  return routeParam(BranchParams, "branchId", c.req.param("branchId"));
}

function categoryId(c: Context<TenantEnv>) {
  return routeParam(CategoryParams, "categoryId", c.req.param("categoryId"));
}

function productId(c: Context<TenantEnv>) {
  return routeParam(ProductParams, "productId", c.req.param("productId"));
}

const categoryIdParameter = {
  name: "categoryId",
  in: "path",
  required: true,
  description: "Id (UUIDv7) de la categoría.",
  schema: { type: "string", format: "uuid" },
} as const;

const productIdParameter = {
  name: "productId",
  in: "path",
  required: true,
  description: "Id (UUIDv7) del producto.",
  schema: { type: "string", format: "uuid" },
} as const;

const branchParameters = [orgIdParameter, branchIdParameter];
const tags = ["Catálogo"];
const menuNotFound = jsonResponse(
  "La organización o la sucursal no existen, o la sucursal no está asignada a tu cuenta.",
  ErrorResponse,
);
const categoryNotFound = jsonResponse(
  "La organización, la sucursal o la categoría no existen (o la categoría ya se borró).",
  ErrorResponse,
);
const productNotFound = jsonResponse(
  "La organización, la sucursal o el producto no existen (o el producto ya se borró).",
  ErrorResponse,
);
const orderConflict = jsonResponse(
  "La lista de ids no coincide con los elementos actuales: alguien agregó o borró algo. Vuelve a leer el menú.",
  ErrorResponse,
);
const productConflict = jsonResponse(
  "El producto cambió desde que lo leíste (`version` vieja). Vuelve a leerlo.",
  ErrorResponse,
);

// Se monta en `orgScoped` (`/v1/orgs/:orgId/branches/:branchId/menu`), que ya aplicó
// `requireAuth`, `requireMembership()` y `requireOperable()`. Toda mutación sube `menuVersion`.
export const catalogRoutes = new Hono<TenantEnv>()
  .get(
    "/",
    describeRoute({
      tags,
      summary: "Consultar el menú de la sucursal para el panel",
      description:
        "Menú completo: categorías en orden con sus productos, variantes y grupos de opciones. Incluye productos no disponibles; nunca los borrados.",
      security: privateSecurity,
      parameters: branchParameters,
      responses: {
        200: jsonResponse("Menú de la sucursal.", MenuDto),
        ...orgScopedResponses,
        404: menuNotFound,
      },
    }),
    requirePermission("catalog:read"),
    requireBranch(),
    async (c) => c.json(await getMenu(deps(c), branchId(c))),
  )
  .post(
    "/categories",
    describeRoute({
      tags,
      summary: "Crear una categoría",
      description: "Se agrega al final del menú. Hasta 100 categorías por menú.",
      security: privateSecurity,
      parameters: branchParameters,
      responses: {
        201: jsonResponse("Categoría creada.", CategoryDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: menuNotFound,
        422: jsonResponse("El menú ya tiene 100 categorías.", ErrorResponse),
      },
    }),
    requirePermission("catalog:write"),
    requireBranch(),
    validator("json", CreateCategoryInput, rejectWith(CreateCategoryInput)),
    async (c) => c.json(await createCategory(deps(c), branchId(c), c.req.valid("json")), 201),
  )
  .put(
    "/categories/order",
    describeRoute({
      tags,
      summary: "Ordenar las categorías",
      description:
        "`ids` es la lista completa de categorías no borradas en el orden deseado. Cada categoría reordenada sube su `version`.",
      security: privateSecurity,
      parameters: branchParameters,
      responses: {
        200: jsonResponse("Posición y `version` nuevas de cada categoría.", ReorderResultDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: menuNotFound,
        409: orderConflict,
      },
    }),
    requirePermission("catalog:write"),
    requireBranch(),
    validator("json", ReorderInput, rejectWith(ReorderInput)),
    async (c) => c.json(await reorderCategories(deps(c), branchId(c), c.req.valid("json"))),
  )
  .patch(
    "/categories/:categoryId",
    describeRoute({
      tags,
      summary: "Renombrar una categoría",
      description:
        "Con `version` obligatorio. La posición cambia solo con `PUT /categories/order`.",
      security: privateSecurity,
      parameters: [...branchParameters, categoryIdParameter],
      responses: {
        200: jsonResponse("Categoría actualizada.", CategoryDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: categoryNotFound,
        409: jsonResponse(
          "La categoría cambió desde que la leíste (`version` vieja). Vuelve a leerla.",
          ErrorResponse,
        ),
      },
    }),
    requirePermission("catalog:write"),
    requireBranch(),
    validator("json", UpdateCategoryInput, rejectWith(UpdateCategoryInput)),
    async (c) =>
      c.json(await updateCategory(deps(c), branchId(c), categoryId(c), c.req.valid("json"))),
  )
  .delete(
    "/categories/:categoryId",
    describeRoute({
      tags,
      summary: "Borrar una categoría",
      description:
        "Borrado lógico. Solo si ya no tiene productos (ni siquiera no disponibles): muévelos o bórralos antes.",
      security: privateSecurity,
      parameters: [...branchParameters, categoryIdParameter],
      responses: {
        204: { description: "Categoría borrada." },
        403: forbidden,
        ...orgScopedResponses,
        404: categoryNotFound,
        422: jsonResponse("La categoría todavía tiene productos.", ErrorResponse),
      },
    }),
    requirePermission("catalog:write"),
    requireBranch(),
    async (c) => {
      await deleteCategory(deps(c), branchId(c), categoryId(c));
      return c.body(null, 204);
    },
  )
  .put(
    "/categories/:categoryId/products/order",
    describeRoute({
      tags,
      summary: "Ordenar los productos de una categoría",
      description:
        "`ids` es la lista completa de productos no borrados de la categoría en el orden deseado. Cada producto reordenado sube su `version`.",
      security: privateSecurity,
      parameters: [...branchParameters, categoryIdParameter],
      responses: {
        200: jsonResponse("Posición y `version` nuevas de cada producto.", ReorderResultDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: categoryNotFound,
        409: orderConflict,
      },
    }),
    requirePermission("catalog:write"),
    requireBranch(),
    validator("json", ReorderInput, rejectWith(ReorderInput)),
    async (c) =>
      c.json(await reorderProducts(deps(c), branchId(c), categoryId(c), c.req.valid("json"))),
  )
  .post(
    "/products",
    describeRoute({
      tags,
      summary: "Crear un producto",
      description:
        "Se agrega al final de su categoría, con sus variantes y grupos de opciones. Precios en centavos. Respeta el límite de productos del plan.",
      security: privateSecurity,
      parameters: branchParameters,
      responses: {
        201: jsonResponse("Producto creado.", ProductDto),
        400: invalidInput,
        402: jsonResponse("El plan ya no admite otro producto.", ErrorResponse),
        403: forbidden,
        ...orgScopedResponses,
        404: categoryNotFound,
      },
    }),
    requirePermission("catalog:write"),
    requireBranch(),
    validator("json", CreateProductInput, rejectWith(CreateProductInput)),
    async (c) => c.json(await createProduct(deps(c), branchId(c), c.req.valid("json")), 201),
  )
  .patch(
    "/products/:productId",
    describeRoute({
      tags,
      summary: "Editar un producto",
      description:
        "Cambios parciales con `version` obligatorio. `variants` y `optionGroups`, si se envían, reemplazan la lista completa (sus ids cambian). Otra `categoryId` mueve el producto al final de esa categoría.",
      security: privateSecurity,
      parameters: [...branchParameters, productIdParameter],
      responses: {
        200: jsonResponse("Producto actualizado.", ProductDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: productNotFound,
        409: productConflict,
      },
    }),
    requirePermission("catalog:write"),
    requireBranch(),
    validator("json", UpdateProductInput, rejectWith(UpdateProductInput)),
    async (c) =>
      c.json(await updateProduct(deps(c), branchId(c), productId(c), c.req.valid("json"))),
  )
  .delete(
    "/products/:productId",
    describeRoute({
      tags,
      summary: "Borrar un producto",
      description:
        "Borrado lógico: deja de aparecer en el menú, pero los pedidos que lo tienen lo conservan.",
      security: privateSecurity,
      parameters: [...branchParameters, productIdParameter],
      responses: {
        204: { description: "Producto borrado." },
        403: forbidden,
        ...orgScopedResponses,
        404: productNotFound,
      },
    }),
    requirePermission("catalog:write"),
    requireBranch(),
    async (c) => {
      await deleteProduct(deps(c), branchId(c), productId(c));
      return c.body(null, 204);
    },
  )
  .patch(
    "/products/:productId/availability",
    describeRoute({
      tags,
      summary: "Marcar un producto como disponible o agotado",
      description:
        "Con `version` obligatorio. Es el único cambio de producto que puede hacer el personal (`staff`) en sus sucursales.",
      security: privateSecurity,
      parameters: [...branchParameters, productIdParameter],
      responses: {
        200: jsonResponse("Producto actualizado.", ProductDto),
        400: invalidInput,
        403: forbidden,
        ...orgScopedResponses,
        404: productNotFound,
        409: productConflict,
      },
    }),
    requirePermission("catalog:availability"),
    requireBranch(),
    validator("json", ProductAvailabilityInput, rejectWith(ProductAvailabilityInput)),
    async (c) =>
      c.json(await setAvailability(deps(c), branchId(c), productId(c), c.req.valid("json"))),
  );
