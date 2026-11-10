# AGENTS.md — `apps/web` (frontend MenusMax)

Instrucciones para cualquier agente de IA (Claude Code, Codex, Cursor, Stitch, etc.) que trabaje en el frontend de MenusMax. Aplica solo a `apps/web`. El backend (`apps/api`, Hono) tiene sus propias reglas y **no se toca desde aquí**.

---

## 0. Antes de escribir una sola línea

1. **Lee `DESIGN.md` completo** (en esta misma carpeta, `apps/web/DESIGN.md`). Es la fuente de verdad del diseño: tokens, tipografía, componentes permitidos, movimiento, textos, flujo y lista negra. Si una instrucción de la tarea contradice `DESIGN.md`, **detente y pregunta**; no improvises.
2. Lee `README.md` de la raíz para la arquitectura (SvelteKit → Service Binding → Hono, D1, R2, Queues).
3. Revisa la tarea en `docs/tasks/` o el issue asignado, y `docs/STATUS.md` si existe.
4. Ubica la pantalla en el flujo de `DESIGN.md §7` antes de tocarla. Si la pantalla no existe en ese flujo, pregunta antes de crearla.

Confirma en tu primer mensaje: "Leí DESIGN.md" y en una línea qué pantalla/archivo vas a tocar.

---

## 1. Stack y versiones

| Pieza       | Elección                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| Framework   | SvelteKit 2 + **Svelte 5 (Runes)**                                       |
| Lenguaje    | TypeScript estricto                                                      |
| Estilos     | **Tailwind CSS v4** (configuración en CSS, sin `tailwind.config.js`)     |
| Componentes | **shadcn-svelte** (sobre `bits-ui`) en `$lib/components/ui`              |
| Íconos      | `@lucide/svelte`                                                         |
| Validación  | Zod desde `packages/contracts` (no se redefinen esquemas en el frontend) |
| Adaptador   | `@sveltejs/adapter-cloudflare` (Worker `web`)                            |
| Pruebas     | Vitest + `@testing-library/svelte`, Playwright para E2E                  |
| Gestor      | pnpm workspaces                                                          |

**Dependencias permitidas en `apps/web`:** las de arriba más las que instala shadcn-svelte (`bits-ui`, `tailwind-variants`, `clsx`, `tailwind-merge`, `tw-animate-css`). Cualquier otra dependencia necesita un ADR en `docs/adr/` aprobado antes de instalarla. Prohibido en particular: librerías de estado global, de formularios (superforms incluido, salvo ADR), de animación, de fechas pesadas, de CSS-in-JS, y kits de UI distintos a shadcn-svelte.

---

## 2. Comandos

Desde la raíz del monorepo:

```bash
pnpm --filter web dev          # servidor de desarrollo
pnpm --filter web check        # svelte-check (tipos + a11y del compilador)
pnpm --filter web lint         # eslint + prettier
pnpm --filter web test         # vitest
pnpm --filter web test:e2e     # playwright
pnpm --filter web build        # build de producción (adapter-cloudflare)
```

Añadir primitivas de shadcn-svelte (desde `apps/web`):

```bash
pnpm dlx shadcn-svelte@latest add button input label
```

Nunca ejecutes `deploy`, migraciones remotas ni `wrangler` contra entornos remotos. Eso lo hace un humano o CI.

---

## 3. Estructura

```text
apps/web/
├── AGENTS.md
├── DESIGN.md
├── components.json                # config de shadcn-svelte
├── svelte.config.js
├── wrangler.jsonc                 # binding API → Worker Hono
└── src/
    ├── app.css                    # Tailwind v4 + tokens (copiado de DESIGN.md §3.5)
    ├── app.d.ts                   # App.Locals, App.Platform, App.Error
    ├── app.html
    ├── hooks.server.ts            # sesión → locals, requestId, cabeceras de seguridad
    ├── lib/
    │   ├── components/
    │   │   ├── ui/                # shadcn-svelte (generado por CLI, restilado)
    │   │   ├── Phone.svelte
    │   │   ├── MenuView.svelte
    │   │   └── OrderCard.svelte
    │   ├── server/                # solo servidor: nunca se importa desde el cliente
    │   │   └── api.ts             # cliente tipado sobre platform.env.API
    │   ├── cart.svelte.ts
    │   ├── money.ts
    │   └── utils.ts               # cn()
    └── routes/                    # ver DESIGN.md §8
```

Reglas:

- **No crees carpetas o archivos que la tarea no necesita.** Nada de `features/`, `services/`, `stores/`, `hooks/`, `constants/` "por si acaso".
- Un componente nuevo en `$lib/components` solo existe si se usa en **dos o más rutas**. Si se usa en una, vive dentro de la ruta como snippet (`{#snippet}`) o inline.
- No se crean wrappers encima de shadcn (`MyButton`, `AppInput`…). Se usa la primitiva con sus variantes.

---

## 4. Diseño: reglas no negociables

Resumen operativo de `DESIGN.md`. Si dudas, el documento manda.

- **Colores:** solo tokens (`bg-primary`, `text-muted-foreground`, `border-border`, `bg-cal`, `text-tinta`, `text-nopal`…). **Prohibido** escribir hex o colores de la paleta por defecto de Tailwind (`bg-gray-100`, `text-slate-500`, `bg-blue-600`) en componentes.
- **`cempasuchil`** solo para "pedido nuevo" y el contador del carrito en vista previa.
- **Storefront** (`/m/[slug]`, `/pedido/[token]`) usa exclusivamente `var(--brand)`, `var(--brand-bg)`, `var(--brand-text)`. Nunca colores de MenusMax.
- **Tipografía:** Onest, escala de `DESIGN.md §3.3`. Precios con `tabular-nums`.
- **Sin:** gradientes, sombras (salvo `Phone`), mayúsculas decorativas, eyebrows, numeración decorativa, flechas en botones, tarjetas como decoración.
- **Radios:** `rounded-xl` contenedores, `rounded-lg` inputs/botones, `rounded-full` solo chips, botón `+` y pastillas.
- **Sin modales** salvo `AlertDialog` para eliminar producto o categoría.
- **Movimiento:** solo los eventos listados en `DESIGN.md §5`, siempre con `motion-safe:` o respetando `prefers-reduced-motion`.
- **Textos:** español de México, tú, sentence case, verbos concretos; vocabulario fijo de `DESIGN.md §6` (menú, producto, pedido, modalidad, panel).

### shadcn-svelte

- Solo las primitivas de la tabla de `DESIGN.md §4.0`. Las de la lista "no se instalan" están prohibidas.
- Tras cada `add`, **restila** el archivo generado en `$lib/components/ui/<nombre>`:
  - `h-12` en `Button` (tamaño `default`) e `Input`.
  - Quita `shadow-xs` / `shadow-sm`.
  - Foco: `focus-visible:ring-2 focus-visible:ring-ring/30`.
- Los archivos de `ui/` son código nuestro: se editan para alinearlos al diseño, pero no se les agrega lógica de negocio.
- Combina clases con `cn()` de `$lib/utils`. No concatenes strings de clases a mano.
- Si un elemento nativo resuelve mejor el caso (`<details>`, `<select>` en móvil, `input type=color`, `input type=file`), usa el nativo con los patrones de clase de `DESIGN.md §4.2`.

---

## 5. Svelte 5: cómo se escribe aquí

**Sí:**

- `let { data, form } = $props();` con tipos de `./$types` (`PageProps`, `LayoutProps`).
- `$state` para estado local, `$derived` para todo lo calculable.
- `$effect` **solo** para sincronizar con algo externo (storage, `setInterval`, APIs del navegador). Si estás actualizando un `$state` a partir de otro `$state` dentro de un `$effect`, eso es un `$derived`.
- `$bindable` solo cuando el padre realmente necesita el valor de vuelta.
- Eventos como atributos: `onclick={...}`, `onsubmit={...}`.
- Contenido con `{#snippet}` y `{@render children()}`.
- Estado reutilizable en archivos `.svelte.ts` como **clases** (`class Cart { items = $state([]); total = $derived(...) }`) instanciadas por contexto.
- `import { page } from '$app/state'` para la URL y datos de página.
- `{#each items as item (item.id)}` siempre con key.

**No:**

- `export let`, `$:`, `on:click`, `<slot>`, `createEventDispatcher`, `$app/stores`, `writable`/`readable` de `svelte/store`.
- **Estado mutable a nivel de módulo** compartido (`export const cart = $state(...)` en un módulo). En SSR se comparte entre usuarios. Usa `setContext`/`getContext` desde un layout.
- `{@html}` con datos de usuario. Solo se permite con SVG generado por nuestra API (QR).
- Lógica de negocio en componentes (cálculo de totales definitivos, permisos, transiciones válidas). Eso es de la API.

---

## 6. SvelteKit: datos, formularios y servidor

### 6.1 Carga de datos

- Datos que requieren la API → `+page.server.ts` / `+layout.server.ts`. El navegador **nunca** llama al Worker `api` directamente.
- La API se consume solo a través de `$lib/server/api.ts`, que usa `event.platform.env.API.fetch(...)` (Service Binding) y reenvía el contexto de sesión validado.
- Tipa `App.Platform` en `app.d.ts` con el binding `API`. No uses `process.env`; los secretos y bindings vienen de `platform.env` o `$env/static/private` / `$env/dynamic/private`.
- Usa `depends('app:pedidos')` + `invalidate('app:pedidos')` para refrescar. Polling solo donde `DESIGN.md` lo indica, en un `$effect` que limpie su intervalo.
- Para datos lentos no críticos, devuelve la promesa sin `await` desde `load` y resuélvela con `{#await}`.
- `error(404, ...)` y `redirect(303, ...)` de `@sveltejs/kit`; nunca devuelvas objetos de error a mano.

### 6.2 Formularios y mutaciones

- **Toda mutación es una form action** (`export const actions`) consumida con `<form method="POST" use:enhance>`. Sin `fetch` manual desde el cliente para mutar.
- El formulario funciona sin JavaScript. `use:enhance` solo mejora: estado de carga, evitar recarga y foco en el primer error.
- Patrón de envío:
  ```svelte
  <form method="POST" action="?/avanzar" use:enhance={() => {
    enviando = true;
    return async ({ update }) => { await update(); enviando = false; };
  }}>
  ```
- Valida en el servidor con el esquema Zod de `packages/contracts`. Devuelve `fail(400, { fieldErrors, values })` y muestra el error bajo cada campo con `aria-invalid` y `aria-describedby`.
- **Nunca envíes precios ni totales desde el cliente** como dato confiable. El checkout manda ids, variantes y cantidades; la API recalcula.
- Checkout: incluye la clave de idempotencia generada en `load` como `<input type="hidden">`.
- Tras crear algo, `redirect(303, ...)`.
- No desactives la protección CSRF de SvelteKit (`csrf.checkOrigin`).

### 6.3 Sesión y rutas protegidas

- `hooks.server.ts` resuelve la sesión una vez y la deja en `event.locals.session`.
- `app/+layout.server.ts` protege todo `/app/*`: sin sesión → `redirect(303, '/entrar')`.
- Cookies `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/'`. Nunca expongas tokens al cliente ni los pongas en la URL (excepto el token de seguimiento público, que es su diseño).

### 6.4 Renderizado y caché

- Landing `(marketing)`: `export const prerender = true` si no depende de datos dinámicos.
- Menú público: SSR con `setHeaders({ 'cache-control': 'public, max-age=60, s-maxage=300' })` (ajustar según el ADR de caché). **Nunca** caches `/app/*`, checkout ni `/pedido/[token]`.
- `<svelte:head>` en cada ruta pública: `<title>`, `description`, Open Graph con nombre y portada del negocio.
- `import.meta.env.SSR` / `browser` de `$app/environment` para el código que solo corre en el navegador. `localStorage` y `sessionStorage`, siempre en `try/catch`.

### 6.5 Imágenes

- Siempre `width`, `height`, `alt` (nombre del producto), `loading="lazy"` y `decoding="async"` excepto la portada del negocio.
- Las URLs las entrega la API; no construyas rutas de R2 en el frontend.

---

## 7. Accesibilidad y calidad (piso, no extra)

- Mobile-first, probado a 360px.
- Áreas táctiles ≥ 44px.
- Foco visible en todo lo interactivo; orden de tabulación lógico.
- Cada input tiene `<Label>` asociado. Los botones de solo ícono llevan `aria-label`.
- `aria-live="polite"` para "Guardado", cambios de estado de pedido y el contador del carrito.
- Contraste AA con tokens de MenusMax y con cualquier tema del negocio.
- `svelte-check` sin advertencias de a11y. No silencies advertencias con `svelte-ignore` sin justificar en un comentario.

---

## 8. Pruebas

- Lógica pura (`money.ts`, `cart.svelte.ts`, slugify): unitarias con Vitest.
- Componentes con lógica (`MenuView`, `OrderCard`): pruebas de interacción con `@testing-library/svelte`.
- Flujos críticos en Playwright: landing → `/crear` → publicar → `/app/listo`; menú → carrito → checkout → seguimiento; aceptar y avanzar un pedido en el panel.
- La API se simula en pruebas; no apuntes a entornos remotos.

---

## 9. Definición de terminado

Antes de reportar una tarea como terminada:

- [ ] Leí `DESIGN.md` y la pantalla respeta tokens, tipografía, radios, movimiento y textos.
- [ ] Cero hex sueltos y cero colores de la paleta por defecto de Tailwind en componentes.
- [ ] Solo primitivas shadcn permitidas, restiladas; sin wrappers nuevos.
- [ ] Sin `export let`, `$:`, `on:`, stores ni estado mutable de módulo.
- [ ] Las mutaciones son form actions con `use:enhance` y funcionan sin JS.
- [ ] Ningún dato de la API se pide desde el navegador; todo pasa por `$lib/server/api.ts`.
- [ ] Ninguna dependencia nueva fuera de la lista permitida.
- [ ] `pnpm --filter web check`, `lint` y `test` pasan.
- [ ] Revisé la pantalla a 360px y en desktop, con teclado.
- [ ] Reporte final: archivos tocados, qué cambió y cualquier punto donde `DESIGN.md` no cubría el caso.

---

## 10. Cuándo detenerte y preguntar

- La tarea pide algo de la lista negra de `DESIGN.md §11`.
- Necesitas una dependencia nueva o una primitiva shadcn no permitida.
- La pantalla no existe en el flujo de `DESIGN.md §7`.
- Necesitas un endpoint o un contrato que no existe en `packages/contracts`. No lo inventes en el frontend.
- Un cambio afectaría el backend, migraciones o `wrangler.jsonc`.
