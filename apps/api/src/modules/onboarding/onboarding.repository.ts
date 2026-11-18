import type { BranchModes } from "@menu-max/contracts";
import {
  branches,
  businesses,
  categories,
  menus,
  organizationMembers,
  organizations,
  products,
  storefrontThemes,
  subscriptions,
} from "@menu-max/database";
import { getTableColumns } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../../infrastructure/db";

export type NewOnboarding = {
  ids: {
    orgId: string;
    memberId: string;
    subscriptionId: string;
    businessId: string;
    branchId: string;
    menuId: string;
    categoryId: string;
    themeId: string;
  };
  userId: string;
  businessName: string;
  branch: {
    modes: BranchModes;
    tableCount: number;
    alertWhatsapp: string | null;
  };
  trial: { planId: string; periodEnd: Date };
  slug: string;
  categoryName: string;
  products: { id: string; name: string; priceCents: number }[];
  now: Date;
};

/**
 * Productos en orden, en varias sentencias: D1 admite hasta 100 parámetros por sentencia y
 * Drizzle envía uno por columna de cada fila (mismo criterio que `catalog.repository`).
 */
function productStatements(db: Db, data: NewOnboarding) {
  const rows = data.products.map((product, position) => ({
    id: product.id,
    organizationId: data.ids.orgId,
    menuId: data.ids.menuId,
    categoryId: data.ids.categoryId,
    name: product.name,
    priceCents: product.priceCents,
    position,
    createdAt: data.now,
    updatedAt: data.now,
  }));
  const perStatement = Math.floor(100 / Object.keys(getTableColumns(products)).length);
  const statements: BatchItem<"sqlite">[] = [];
  for (let start = 0; start < rows.length; start += perStatement) {
    statements.push(db.insert(products).values(rows.slice(start, start + perStatement)));
  }
  return statements;
}

/**
 * Sentencias del alta completa (T20), en orden de dependencias, para un solo `db.batch`: la
 * organización con su `owner` y suscripción, el negocio, la sucursal, el menú publicado con su
 * categoría y productos, y el tema `minimal`. Todas llevan el `organization_id` nuevo.
 */
export function onboardingStatements(db: Db, data: NewOnboarding) {
  const { ids, now } = data;
  const orgId = ids.orgId;
  const stamps = { createdAt: now, updatedAt: now };
  const alertWhatsapp = data.branch.alertWhatsapp;
  return [
    db.insert(organizations).values({ id: orgId, name: data.businessName, ...stamps }),
    db.insert(organizationMembers).values({
      id: ids.memberId,
      organizationId: orgId,
      userId: data.userId,
      role: "owner",
      ...stamps,
    }),
    db.insert(subscriptions).values({
      id: ids.subscriptionId,
      organizationId: orgId,
      planId: data.trial.planId,
      status: "trialing",
      currentPeriodEnd: data.trial.periodEnd,
      ...stamps,
    }),
    db
      .insert(businesses)
      .values({ id: ids.businessId, organizationId: orgId, name: data.businessName, ...stamps }),
    db.insert(branches).values({
      id: ids.branchId,
      organizationId: orgId,
      businessId: ids.businessId,
      name: data.businessName,
      modeTable: data.branch.modes.table,
      modePickup: data.branch.modes.pickup,
      modeDelivery: data.branch.modes.delivery,
      tableCount: data.branch.tableCount,
      alertWhatsapp,
      // Quien captura el número confirma que acepta avisos (igual que al crear una sucursal).
      alertOptInAt: alertWhatsapp ? now : null,
      ...stamps,
    }),
    db.insert(menus).values({
      id: ids.menuId,
      organizationId: orgId,
      branchId: ids.branchId,
      slug: data.slug,
      status: "published",
      publishedAt: now,
      ...stamps,
    }),
    db.insert(categories).values({
      id: ids.categoryId,
      organizationId: orgId,
      menuId: ids.menuId,
      name: data.categoryName,
      position: 0,
      ...stamps,
    }),
    ...productStatements(db, data),
    db.insert(storefrontThemes).values({
      id: ids.themeId,
      organizationId: orgId,
      menuId: ids.menuId,
      preset: "minimal",
      updatedAt: now,
    }),
  ] as const;
}
