import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Se ejecuta antes de cada archivo de pruebas; aplicar es idempotente.
const { DB, TEST_MIGRATIONS } = env as unknown as {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};
await applyD1Migrations(DB, TEST_MIGRATIONS);
