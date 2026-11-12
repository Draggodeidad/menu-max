import * as schema from "@menu-max/database";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../env";

// Se crea por petición (sin estado a nivel de módulo). Los repositorios reciben `db`.
export function createDb(env: Pick<Env, "DB">) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof createDb>;

/** Verifica que D1 responde. Lanza si la base no está disponible. */
export async function pingDb(db: Db): Promise<void> {
  await db.run(sql`select 1`);
}
