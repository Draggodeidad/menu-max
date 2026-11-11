# Task 08 — Aislar y comprobar la sesión simulada

**Prioridad:** P1
**Categoría:** Arquitectura
**Depende de:** task-01

## Contexto

`apps/web/src/routes/(auth)/entrar/+page.server.ts` redirige con cualquier correo válido y contraseña no vacía. `apps/web/src/routes/app/+layout.server.ts` carga el panel sin comprobar sesión ni usar `event.locals`, por lo que una navegación limpia a `/app` no pasa por `/entrar`. `apps/web/AGENTS.md` pide una sesión simulada aislada y guardia para `/app/*`.

## Objetivo

Simular de forma explícita una sesión por navegador y proteger las rutas del panel durante la fase mock, sin presentar esto como autenticación real.

## Archivos involucrados

- `apps/web/src/hooks.server.ts` (nuevo si se necesita)
- `apps/web/src/app.d.ts`
- `apps/web/src/routes/(auth)/entrar/+page.server.ts`
- `apps/web/src/routes/app/+layout.server.ts`
- `apps/web/src/routes/crear/+page.server.ts`
- `e2e/flujos.spec.ts`
- `e2e/navegacion.spec.ts`
- `e2e/helpers.ts`

## Pasos sugeridos

1. Aislar la sesión demo en `event.locals` y un mecanismo local por navegador, con atributos adecuados a la fase mock.
2. Crear la sesión al completar login o publicación simulados y redirigir `/app/*` a `/entrar` cuando falte.
3. Preparar un fixture explícito de sesión para las pruebas de rutas internas; conservar una prueba independiente de acceso sin sesión.

## Criterios de aceptación

- [ ] Un navegador limpio se redirige a `/entrar`; el login demo válido abre el panel y la publicación no interrumpe la activación.
- [ ] Se reactiva y pasa `e2e/flujos.spec.ts › el panel exige sesión simulada antes de entrar`.
- [ ] Pasan `e2e/flujos.spec.ts › login simulado redirige al panel` y la navegación de todas las rutas con el fixture de sesión.

## Fuera de alcance

Autenticación real, gestión real de contraseñas, identidad de terceros, API y recuperación de cuenta.
