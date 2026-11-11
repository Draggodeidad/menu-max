# Task 02 — Conectar pedido, panel y seguimiento simulados

**Prioridad:** P0
**Categoría:** Mocks
**Depende de:** ninguna

## Contexto

`apps/web/src/routes/m/[slug]/pedido/+page.server.ts` redirige a un token sin guardar el pedido. `getPedido` en `apps/web/src/lib/server/demo.ts` devuelve Rodrigo y $103.00 fijos; `getPanelPedidos` usa una lista independiente. El avance del panel solo se guarda en la cookie `demo_avance`. Una horchata pedida por Ana nunca aparece en seguimiento ni en el panel.

## Objetivo

Hacer coherente el ciclo simulado de creación, consulta y avance de un pedido dentro de la misma sesión de demostración, con un contrato de datos tipado y reemplazable.

## Archivos involucrados

- `apps/web/src/lib/server/demo.ts`
- `apps/web/src/routes/m/[slug]/pedido/+page.server.ts`
- `apps/web/src/routes/pedido/[token]/+page.server.ts`
- `apps/web/src/routes/app/+page.server.ts`
- `apps/web/src/lib/components/OrderCard.svelte`
- `e2e/flujos.spec.ts`

## Pasos sugeridos

1. Definir operaciones y tipos temporales en el mock de servidor para crear, leer y avanzar pedidos; preservar ids, cantidades, modalidad y datos del cliente y calcular importes en centavos desde el catálogo del servidor.
2. Guardar el estado de demo acotado a la sesión/navegador y consultarlo desde seguimiento y panel, sin estado mutable compartido por módulo SSR.
3. Sincronizar las transiciones del panel con el seguimiento por token; mantener los estados simulados de desarrollo y su tratamiento de errores.
4. Aclarar en el reporte de implementación la limitación entre navegadores: sin backend no se simula sincronización multiusuario real.

## Criterios de aceptación

- [ ] Un pedido de Ana con una horchata aparece con $35.00 en seguimiento y en el panel; aceptarlo actualiza su seguimiento.
- [ ] Los datos siguen disponibles tras recargar en el mismo navegador, no se confunden con el pedido demo base y no se confían totales enviados por el cliente.
- [ ] Se reactivan y pasan `e2e/flujos.spec.ts › pedido simulado llega al seguimiento con los datos capturados` y `e2e/flujos.spec.ts › pedido simulado aparece en el panel del negocio`.
- [ ] Sigue pasando `e2e/flujos.spec.ts › acepta y avanza un pedido y conserva el cambio al recargar`.

## Fuera de alcance

Persistencia multiusuario real, mensajería externa, backend, WebSockets y cobros.
