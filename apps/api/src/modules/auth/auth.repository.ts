import { users } from "@menu-max/database";
import { and, eq, type SQL } from "drizzle-orm";
import type { Db } from "../../infrastructure/db";

/** Estado del correo de un usuario. `email_status` no viaja en la sesión de Better Auth. */
export function findEmailState(db: Db, userId: string) {
  return db
    .select({
      email: users.email,
      emailVerified: users.emailVerified,
      emailStatus: users.emailStatus,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

/** `email_status` de la cuenta con ese correo normalizado, si existe. */
export function findEmailStatusByEmail(db: Db, email: string) {
  return db
    .select({ emailStatus: users.emailStatus })
    .from(users)
    .where(eq(users.email, email))
    .get();
}

export function findUserIdByEmail(db: Db, email: string) {
  return db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
}

/** Sentencia para un `db.batch`: marca el correo verificado solo si se cumple `when`. */
export function markEmailVerified(db: Db, userId: string, when: SQL) {
  return db
    .update(users)
    .set({ emailVerified: true })
    .where(and(eq(users.id, userId), when));
}
