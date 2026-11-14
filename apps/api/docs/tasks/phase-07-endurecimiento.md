# Fase B7 — Endurecimiento para el piloto

> Planeación local (en `.gitignore`).
> **Criterio para cerrar la fase:** presupuestos de p95 cumplidos en staging y restauración de D1 probada.
> **Orden de ejecución:** T26 → T27.
> **Regla:** el agente escribe scripts, runbooks y código; todo lo que se ejecuta contra staging o producción lo corre un humano.

---

## T26 — Auditoría, mantenimiento y retención

**Fase:** B7 · **Depende de:** T25 · **ADR:** 015 (Propuesto) · **Rama sugerida:** `feat/t26-auditoria-mantenimiento`

> La anonimización por retención depende de ADR-015 (`Propuesto`). Implementa auditoría y limpieza; deja la anonimización hasta que se acepte el plazo.

### Objetivo

Los eventos sensibles quedan auditados sin datos personales innecesarios, y la base no acumula basura operativa.

### Alcance

- Tabla `audit_logs (id, organization_id nullable, actor_user_id, action, target_type, target_id, metadata_json, ip_hash, created_at)`; índice `(organization_id, created_at)`.
- `shared/audit.ts`: `audit(deps, action, target, metadata)` que se agrega **al mismo `batch`** de la operación auditada cuando existe.
- Conectar en los servicios existentes: `auth.login`, `auth.login_failed` (sin contraseña), `auth.password_changed`, `auth.password_reset`, `member.invited`, `member.joined`, `member.role_changed`, `member.removed`, `menu.published`, `menu.unpublished`, `order.cancelled`, `order.rejected`, `subscription.changed`.
- `metadata_json` sin PII: ids, roles, estados; nunca correos, teléfonos ni direcciones. `ip_hash` con sal del entorno.
- `GET /v1/orgs/:orgId/audit` (`audit:read`, solo `owner`, ya listado en ADR-007; agregarlo a `permissions.ts` y a la prueba de matriz si T12 no lo incluyó) con cursor.
- Cron diario (el de T09) amplía su limpieza:
  - `idempotency_keys` vencidas;
  - invitaciones vencidas hace más de 30 días;
  - objetos R2 de `media_assets` borrados hace más de 7 días y sin referencias;
  - `notification_outbox` `published` de más de 30 días;
  - sesiones vencidas (si Better Auth no las limpia en la versión instalada).
- Cada tarea del Cron es independiente: si una falla, las demás corren y se registra el error.

### Fuera de alcance

- UI de auditoría en el panel.
- Exportar auditoría antigua a R2 (cuando el volumen lo pida).

### Pruebas requeridas

- [ ] Cada evento listado genera exactamente un registro, en el mismo `batch` que su operación.
- [ ] Ningún `metadata_json` contiene `@` ni secuencias de 10 dígitos (prueba sobre todos los eventos).
- [ ] El Cron borra lo vencido y no toca lo vigente; una tarea que falla no detiene a las otras.
- [ ] `GET /audit` solo `owner`; aislamiento.

---

## T27 — Carga, alertas, runbooks y restauración

**Fase:** B7 · **Depende de:** T26 · **ADR:** 003 · **Rama sugerida:** `feat/t27-operacion-piloto`

### Objetivo

Antes del piloto sabemos cuánto aguanta el sistema, nos enteramos cuando algo falla y tenemos pasos escritos para recuperarnos.

### Alcance

- `tools/seed/synthetic.ts`: genera SQL de datos sintéticos (1000 organizaciones, 1–3 sucursales, 30–80 productos, historial de pedidos) con nombres ficticios. Se aplica en local con `wrangler d1 execute --local`; en staging lo aplica un humano.
- `tools/load/` con escenarios de k6 (herramienta externa, no dependencia del repo):
  - lectura de menú público con y sin acierto de caché;
  - creación de pedidos con llaves de idempotencia únicas y repetidas;
  - polling del panel con `ETag`.
- `docs/performance.md`: presupuestos del plan (menú sin caché p95 150 ms, crear pedido 300 ms, panel 150 ms) y una tabla para registrar resultados de cada corrida.
- Instrumentación: `log.info` con `durationMs` y `rowsRead` en rutas calientes.
- `docs/runbooks/`:
  - `restaurar-d1.md` (Time Travel: consultar bookmark, restaurar, verificar);
  - `reprocesar-dlq.md` (si T24 no lo dejó completo);
  - `rotar-secretos.md` (`INTERNAL_TOKEN`, `BETTER_AUTH_SECRET`, Meta, Turnstile, sin downtime);
  - `incidente-whatsapp.md` (Meta caído: qué ve el negocio, qué hacer);
  - `cambiar-plan.md` (de T14, revisado).
- `docs/alerts.md`: alertas a configurar por un humano en Cloudflare (tasa de 5xx, errores en el consumidor, crecimiento de la DLQ, eventos `pending` viejos en outbox, `RATE_LIMITED` anómalo, consumo de D1).

### Fuera de alcance

- Ejecutar pruebas de carga o restauraciones contra staging o producción (las hace un humano con estos documentos).

### Pruebas requeridas

- [ ] El generador sintético produce SQL que aplica sin errores en D1 local.
- [ ] Los escenarios de k6 corren contra `wrangler dev` local en modo humo (pocas iteraciones).

### Criterios de aceptación

- [ ] Un humano puede seguir cada runbook sin conocimiento previo del código.
- [ ] `docs/performance.md` tiene la primera corrida local registrada.
