import { users } from "@menu-max/database";
import { eq } from "drizzle-orm";
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
