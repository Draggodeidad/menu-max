// Datos de prueba directos en la D1 local. Las organizaciones reales se crean con el onboarding
// (T20); aquí se insertan sin pasar por la API para aislar lo que prueba cada suite.
import type { MemberRole, SubscriptionStatus } from "@menu-max/contracts";
import {
  branches,
  businesses,
  memberBranches,
  organizationMembers,
  organizations,
  plans,
  subscriptions,
  users,
} from "@menu-max/database";
import { makeSignature } from "better-auth/crypto";
import { env } from "cloudflare:workers";
import { getEnv } from "../src/env";
import { createDb } from "../src/infrastructure/db";
import { createAuth } from "../src/modules/auth/auth";
import { newId } from "../src/shared/ids";

const db = () => createDb(getEnv(env));

export type TestUser = {
  id: string;
  email: string;
  /** Header `cookie` con una sesión válida firmada por Better Auth. */
  cookie: string;
};

/** Usuario con sesión activa. No crea contraseña: la sesión se firma como lo hace Better Auth. */
export async function createUser(options: { emailVerified?: boolean } = {}): Promise<TestUser> {
  const id = newId();
  const email = `prueba-${id}@example.com`;
  await db()
    .insert(users)
    .values({ id, email, name: "Prueba", emailVerified: options.emailVerified ?? true });

  const context = await createAuth(getEnv(env)).$context;
  const session = await context.internalAdapter.createSession(id);
  // Mismo formato que el plugin `testUtils` de Better Auth: `token.firma` (HMAC-SHA256).
  const signature = await makeSignature(session.token, context.secret);
  const cookie = `${context.authCookies.sessionToken.name}=${session.token}.${signature}`;
  return { id, email, cookie };
}

export type TestOrg = { orgId: string; ownerMemberId: string; businessId: string };

/**
 * Organización con su miembro `owner`, un negocio (toda sucursal cuelga de uno) y su
 * suscripción. Por defecto `pro` activa, para que los límites del plan no interfieran con lo que
 * prueba cada suite; las pruebas de límites piden `free` y leen sus valores de `plans`.
 */
export async function createOrg(options: {
  ownerId: string;
  name?: string;
  planId?: string;
  status?: SubscriptionStatus;
}): Promise<TestOrg> {
  const orgId = newId();
  const ownerMemberId = newId();
  const businessId = newId();
  const database = db();
  await database.batch([
    database.insert(organizations).values({ id: orgId, name: options.name ?? "Tacos El Güero" }),
    database.insert(organizationMembers).values({
      id: ownerMemberId,
      organizationId: orgId,
      userId: options.ownerId,
      role: "owner",
    }),
    database
      .insert(businesses)
      .values({ id: businessId, organizationId: orgId, name: "Tacos El Güero" }),
    database.insert(subscriptions).values({
      id: newId(),
      organizationId: orgId,
      planId: options.planId ?? "pro",
      status: options.status ?? "active",
    }),
  ]);
  return { orgId, ownerMemberId, businessId };
}

/** Agrega un miembro y, si se indican, sus sucursales asignadas. Devuelve el id del miembro. */
export async function addMember(options: {
  orgId: string;
  userId: string;
  role: MemberRole;
  status?: "active" | "removed";
  branchIds?: string[];
}): Promise<string> {
  const memberId = newId();
  const database = db();
  const assignments = (options.branchIds ?? []).map((branchId) =>
    database.insert(memberBranches).values({ organizationId: options.orgId, memberId, branchId }),
  );
  await database.batch([
    database.insert(organizationMembers).values({
      id: memberId,
      organizationId: options.orgId,
      userId: options.userId,
      role: options.role,
      status: options.status ?? "active",
    }),
    ...assignments,
  ]);
  return memberId;
}

/** Sucursal de un negocio de la organización. Devuelve su id. */
export async function createBranch(options: {
  orgId: string;
  businessId: string;
  name?: string;
}): Promise<string> {
  const id = newId();
  await db()
    .insert(branches)
    .values({
      id,
      organizationId: options.orgId,
      businessId: options.businessId,
      name: options.name ?? "Sucursal Centro",
    });
  return id;
}

/**
 * Plan de prueba con límites propios, para no depender de los valores que siembra
 * la migración. Devuelve su id.
 */
export async function createPlan(
  limits: {
    maxBranches?: number;
    maxProducts?: number;
    maxMembers?: number;
    customTheme?: boolean;
    removeBranding?: boolean;
  } = {},
): Promise<string> {
  const id = `prueba-${crypto.randomUUID()}`;
  await db()
    .insert(plans)
    .values({
      id,
      name: "Plan de prueba",
      maxBranches: limits.maxBranches ?? 5,
      maxProducts: limits.maxProducts ?? 100,
      maxMembers: limits.maxMembers ?? 10,
      customTheme: limits.customTheme ?? false,
      removeBranding: limits.removeBranding ?? false,
    });
  return id;
}
