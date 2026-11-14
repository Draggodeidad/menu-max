// Plugin local de oxlint (T12b, enmienda a ADR-006): ningún `update` ni `delete` de Drizzle sin `where`.
//
// Replica `enforce-update-with-where` y `enforce-delete-with-where` de `eslint-plugin-drizzle`, que no
// carga bajo oxlint (importa `@typescript-eslint/utils` sin declararlo y arrastra `eslint` como peer).
// Si el plugin oficial corrige sus dependencias, se vuelve a él cambiando solo `jsPlugins` en
// `.oxlintrc.json`: los nombres de las reglas y la opción `drizzleObjectName` son los mismos.
//
// Límite conocido (igual que el plugin oficial): solo sigue la cadena dentro de una misma expresión.
// `const q = db.delete(t); q.where(...)` se reporta; escribe la cadena completa.

const DEFAULT_OBJECT_NAMES = ["db"];

/**
 * Nombres configurados del objeto de Drizzle (opción `drizzleObjectName`, string o lista).
 * @param {readonly unknown[]} options
 * @returns {string[]}
 */
function objectNames(options) {
  const first = options[0];
  const value =
    typeof first === "object" && first !== null && "drizzleObjectName" in first
      ? first.drizzleObjectName
      : undefined;
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((name) => typeof name === "string");
  return DEFAULT_OBJECT_NAMES;
}

/**
 * `true` si el nodo es `<nombre>` o `<algo>.<nombre>` con un nombre configurado (`db`, `deps.db`).
 * @param {any} node
 * @param {string[]} names
 */
function isDrizzleObject(node, names) {
  if (node.type === "Identifier") return names.includes(node.name);
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return names.includes(node.property.name);
  }
  return false;
}

/**
 * `true` si la cadena que empieza en `call` (`db.delete(t)...`) pasa por `.where(...)`.
 * @param {any} call
 */
function chainHasWhere(call) {
  let current = call;
  for (;;) {
    const member = current.parent;
    if (member?.type !== "MemberExpression" || member.object !== current) return false;
    if (!member.computed && member.property.type === "Identifier") {
      if (member.property.name === "where") return true;
    }
    const next = member.parent;
    if (next?.type !== "CallExpression" || next.callee !== member) return false;
    current = next;
  }
}

/**
 * Crea la regla que exige `where` después de `<db>.<method>(...)`.
 * @param {"update" | "delete"} method
 */
function enforceWhere(method) {
  return {
    meta: {
      type: "problem",
      docs: {
        description: `Exige \`.where(...)\` en todo \`${method}\` de Drizzle para no afectar la tabla completa.`,
      },
      messages: {
        missingWhere: `\`${method}\` de Drizzle sin \`.where(...)\` afectaría todas las filas de la tabla. Agrega el filtro (incluido \`organization_id\` en tablas de tenant).`,
      },
      schema: [
        {
          type: "object",
          properties: {
            drizzleObjectName: {
              anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
            },
          },
          additionalProperties: false,
        },
      ],
    },
    /** @param {any} context */
    create(context) {
      const names = objectNames(context.options);
      return {
        /** @param {any} node */
        CallExpression(node) {
          const callee = node.callee;
          if (callee.type !== "MemberExpression" || callee.computed) return;
          if (callee.property.type !== "Identifier" || callee.property.name !== method) return;
          if (!isDrizzleObject(callee.object, names)) return;
          if (!chainHasWhere(node)) context.report({ node, messageId: "missingWhere" });
        },
      };
    },
  };
}

export default {
  meta: { name: "drizzle" },
  rules: {
    "enforce-update-with-where": enforceWhere("update"),
    "enforce-delete-with-where": enforceWhere("delete"),
  },
};
