# Runbook — Cambiar el plan o el estado de una suscripción

> Lo ejecuta un humano con acceso a Cloudflare. Ningún agente corre estos comandos (`--remote`).
> No hay cobro automático en el MVP (T14): el plan y el estado se cambian a mano en D1.

## Antes de empezar

- Necesitas `wrangler` autenticado (`pnpm exec wrangler login`) con permiso sobre la base D1 del entorno.
- Trabaja desde `apps/api`. Elige el entorno con `--env`:

  | Entorno    | `--env`      | Base D1               |
  | ---------- | ------------ | --------------------- |
  | Staging    | `staging`    | `menusmax-staging`    |
  | Producción | `production` | `menusmax-production` |

- Ten a la mano el **id de la organización** (UUIDv7, aparece en la URL `/v1/orgs/<id>/...` y en los logs como `orgId`). Nunca busques por correo en los logs: no hay PII ahí.
- Prueba primero en staging.

## 1. Consultar la suscripción actual

```bash
pnpm exec wrangler d1 execute DB --env staging --remote --command "
  SELECT s.organization_id, s.plan_id, p.name, s.status, s.current_period_end,
         p.max_branches, p.max_products, p.max_members, p.custom_theme, p.remove_branding
  FROM subscriptions s JOIN plans p ON p.id = s.plan_id
  WHERE s.organization_id = '<ORG_ID>';"
```

Debe devolver exactamente una fila. Si devuelve cero, la organización no tiene suscripción: es un error de datos (la API responde 500 y registra `subscription.missing`). No la crees a mano; repórtalo para corregirlo con un script revisado.

Planes disponibles:

```bash
pnpm exec wrangler d1 execute DB --env staging --remote --command "
  SELECT id, name, max_branches, max_products, max_members, custom_theme, remove_branding, active FROM plans;"
```

## 2. Cambiar de plan

Solo a un plan con `active = 1`.

```bash
pnpm exec wrangler d1 execute DB --env staging --remote --command "
  UPDATE subscriptions
  SET plan_id = 'pro', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE organization_id = '<ORG_ID>';"
```

- La salida debe indicar `changes: 1`. Con `0`, el id de la organización está mal.
- Bajar de plan no borra nada: si la organización ya excede el nuevo límite, conserva lo que tiene, pero no puede agregar más hasta quedar por debajo (`PLAN_LIMIT_REACHED`).

## 3. Cambiar el estado

Estados válidos: `trialing`, `active`, `past_due`, `suspended` (cualquier otro valor lo rechaza un `CHECK`).

```bash
pnpm exec wrangler d1 execute DB --env staging --remote --command "
  UPDATE subscriptions
  SET status = 'suspended', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE organization_id = '<ORG_ID>';"
```

| Estado      | Efecto en la API                                                               |
| ----------- | ------------------------------------------------------------------------------ |
| `trialing`  | Opera normal.                                                                  |
| `active`    | Opera normal.                                                                  |
| `past_due`  | Opera normal (solo informativo).                                               |
| `suspended` | Lecturas privadas (`GET`) sí; toda escritura privada responde `403 FORBIDDEN`. |

Para reactivar, repite el comando con `status = 'active'`.

Opcional: fijar el fin del periodo (milisegundos UTC), p. ej. 1 de diciembre de 2026 a las 00:00 de Ciudad de México:

```bash
pnpm exec wrangler d1 execute DB --env staging --remote --command "
  UPDATE subscriptions
  SET current_period_end = 1796104800000,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE organization_id = '<ORG_ID>';"
```

## 4. Verificar

1. Repite la consulta del paso 1.
2. El cambio aplica en la siguiente petición: `requireMembership` lee el plan en cada una; no hay caché que purgar.
3. El dueño puede confirmarlo en `GET /v1/orgs/<ORG_ID>/subscription`.

## Lo que este runbook no cubre

- **Cambiar las capacidades de un plan** (`plans.custom_theme`, `plans.remove_branding`): afecta a todas las organizaciones con ese plan. Se hace con una migración revisada, igual que los límites.
- **Cambiar los límites de un plan** (`plans.max_*`): afecta a todas las organizaciones con ese plan. Se hace con una migración revisada en un PR, nunca con `wrangler d1 execute`.
- Cobros, facturas o pasarelas de pago: fuera del MVP.
