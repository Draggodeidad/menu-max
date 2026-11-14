// Pruebas de las reglas locales de Drizzle (T12b). Se corren con `node --test oxlint/` desde la raíz.
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";
import plugin from "./drizzle-plugin.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { sourceType: "module" } });
const named = [{ drizzleObjectName: ["db", "database"] }];
const missingWhere = [{ messageId: "missingWhere" }];

tester.run("enforce-update-with-where", plugin.rules["enforce-update-with-where"], {
  valid: [
    "db.update(products).set({ name: 'Taco' }).where(eq(products.id, id));",
    "await db.update(products).set({ name: 'Taco' }).where(eq(products.id, id)).returning();",
    "db.batch([db.update(products).set({ name: 'Taco' }).where(eq(products.id, id))]);",
    "deps.db.update(products).set({ name: 'Taco' }).where(eq(products.id, id));",
    // Objeto no configurado: no es Drizzle para la regla.
    "cache.update(products).set({ name: 'Taco' });",
    {
      code: "database.update(products).set({ name: 'Taco' }).where(eq(products.id, id));",
      options: named,
    },
  ],
  invalid: [
    { code: "db.update(products).set({ name: 'Taco' });", errors: missingWhere },
    { code: "await db.update(products).set({ name: 'Taco' }).returning();", errors: missingWhere },
    { code: "db.batch([db.update(products).set({ name: 'Taco' })]);", errors: missingWhere },
    { code: "deps.db.update(products).set({ name: 'Taco' });", errors: missingWhere },
    {
      code: "database.update(products).set({ name: 'Taco' });",
      options: named,
      errors: missingWhere,
    },
    {
      code: "tx.update(products).set({ name: 'Taco' });",
      options: [{ drizzleObjectName: "tx" }],
      errors: missingWhere,
    },
  ],
});

tester.run("enforce-delete-with-where", plugin.rules["enforce-delete-with-where"], {
  valid: [
    "db.delete(products).where(eq(products.id, id));",
    "await db.delete(products).where(eq(products.id, id)).returning();",
    "db.batch([db.insert(products).values(row), db.delete(products).where(eq(products.id, id))]);",
    // `Headers`, `Set` y `Map` también tienen `delete`; no son Drizzle.
    "headers.delete('content-length');",
    "ancestors.delete(value);",
    { code: "database.delete(products).where(eq(products.id, id));", options: named },
  ],
  invalid: [
    { code: "db.delete(products);", errors: missingWhere },
    { code: "await db.delete(products).returning();", errors: missingWhere },
    {
      code: "db.batch([db.insert(products).values(row), db.delete(products)]);",
      errors: missingWhere,
    },
    { code: "database.delete(products);", options: named, errors: missingWhere },
    {
      code: "const q = db.delete(products); q.where(eq(products.id, id));",
      errors: missingWhere,
    },
  ],
});
