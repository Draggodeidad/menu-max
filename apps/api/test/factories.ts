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

// Imágenes mínimas para T17: solo la cabecera que lee `sniffImage`, más unos bytes de relleno.
// No son imágenes decodificables; la API nunca las decodifica.

function u16be(value: number) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u16le(value: number) {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u24le(value: number) {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
}

function u32be(value: number) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u32le(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function ascii(text: string) {
  return [...text].map((char) => char.charCodeAt(0));
}

/** JPEG con APP0 (JFIF), un SOF (`0xC0` baseline o `0xC2` progresivo), SOS y EOI. */
export function jpegBytes(width: number, height: number, sof = 0xc0): Uint8Array {
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, ...u16be(16), ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const components = [1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const frame = [0xff, sof, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3, ...components];
  const scan = [0xff, 0xda, ...u16be(8), 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0x56];
  const eoi = [0xff, 0xd9];
  return new Uint8Array([...soi, ...app0, ...frame, ...scan, ...eoi]);
}

/** PNG con firma, IHDR e IEND (CRC en cero: la API no los valida). */
export function pngBytes(width: number, height: number): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // Profundidad 8, RGBA, sin entrelazado.
  const ihdr = [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0];
  return new Uint8Array([
    ...signature,
    ...u32be(13),
    ...ascii("IHDR"),
    ...ihdr,
    ...u32be(0),
    ...u32be(0),
    ...ascii("IEND"),
    ...u32be(0),
  ]);
}

/** WebP con un fragmento `VP8 ` (lossy), `VP8L` (lossless) o `VP8X` (extendido). */
export function webpBytes(
  width: number,
  height: number,
  kind: "VP8 " | "VP8L" | "VP8X" = "VP8 ",
): Uint8Array {
  const chunk =
    kind === "VP8 "
      ? [0x50, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height), 0, 0]
      : kind === "VP8L"
        ? [0x2f, ...u32le(((width - 1) | ((height - 1) << 14)) >>> 0), 0, 0, 0]
        : [0x10, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
  const body = [...ascii("WEBP"), ...ascii(kind), ...u32le(chunk.length), ...chunk];
  return new Uint8Array([...ascii("RIFF"), ...u32le(body.length), ...body]);
}
