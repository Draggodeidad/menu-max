# DESIGN.md — MenusMax

> Fuente de verdad del diseño de MenusMax (MVP 1.0). Pégalo como contexto en Stitch o Claude Code antes de generar cualquier pantalla. Si una pantalla contradice este documento, gana este documento.

---

## 1. Producto en una línea

Menú digital con pedidos por WhatsApp para negocios de comida en México. Dos conversiones mandan sobre todo lo demás:

1. **El negocio publica su menú.** (Conversión del SaaS)
2. **El comensal envía un pedido.** (Retención del negocio)

Toda pantalla, campo o clic que no empuje una de las dos se elimina.

---

## 2. Principios

1. **Valor antes que cuenta.** El negocio arma su menú antes de registrarse. La cuenta se pide al pulsar "Publicar menú".
2. **El comensal nunca crea cuenta.** Checkout como invitado. "Recordar mis datos" vía `localStorage`.
3. **Una página, no un wizard.** Onboarding, ajustes y checkout son páginas únicas con secciones.
4. **Modales con criterio.** `Dialog`, `Sheet` y `AlertDialog` de shadcn-svelte están permitidos cuando aportan (confirmar eliminar, carrito en móvil, formularios cortos). Para lo que cabe en la página se usa la página.
5. **Nativo cuando basta, componente cuando mejora.** Un `<form>`, `<details>` o `input type=color` se queda nativo si resuelve bien. Si un componente de shadcn-svelte da mejor accesibilidad o acabado, se usa.
6. **Lo que ve el dueño es lo que ve el cliente.** La vista previa y el menú público usan el mismo componente (`MenuView`).
7. **El servidor decide.** Precios, totales, permisos y estados se calculan en la API; la UI solo muestra. (Fase actual: la UI se entrega con datos mock en servidor, ver `AGENTS.md §0.1`; el diseño no cambia cuando llegue la API.)
8. **Una sola audacia.** El momento memorable es el nombre del negocio apareciendo en vivo dentro del teléfono de la vista previa. Todo lo demás es sobrio.

---

## 3. Tokens

### 3.1 Color — marca MenusMax (landing, onboarding, panel)

| Token         | Hex       | Uso                                                                                     |
| ------------- | --------- | --------------------------------------------------------------------------------------- |
| `cal`         | `#F3F4F1` | Fondo de la app y landing                                                               |
| `blanco`      | `#FFFFFF` | Superficies (tarjetas, inputs, formularios)                                             |
| `tinta`       | `#1C1F1A` | Texto principal                                                                         |
| `piedra`      | `#6B7068` | Texto secundario, placeholders, metadatos                                               |
| `linea`       | `#E3E5DF` | Bordes y separadores                                                                    |
| `nopal`       | `#1F5C45` | Marca y acción primaria                                                                 |
| `cempasuchil` | `#F5A300` | **Exclusivo**: pedido nuevo y contador de carrito en preview. Nunca en botones ni texto |
| `error`       | `#B42318` | Mensajes de error y acciones destructivas                                               |

Reglas:

- `cempasuchil` es una alerta, no decoración. Si aparece en más de dos lugares por pantalla, sobra.
- Se permiten degradados sutiles entre tokens de la paleta en fondos y sombras suaves (offset y desenfoque, tintadas con `tinta`) en superficies elevadas: popover, dialog, sheet, dropdown, toast y `Phone`. Siguen prohibidos el texto con degradado y las sombras duras o sin offset.
- Contraste mínimo AA en todo texto. `piedra` sobre `cal` solo para texto ≥ 14px.

### 3.2 Color — storefront (menú público del negocio)

El menú público **no lleva la marca MenusMax**. Usa el tema del negocio vía variables CSS inyectadas en `m/[slug]/+layout.svelte`:

```css
--brand       /* theme.primaryColor */
--brand-bg    /* theme.backgroundColor */
--brand-text  /* theme.textColor */
```

Presets iniciales (`theme.preset`):

| Preset    | `--brand` | `--brand-bg` | `--brand-text` |
| --------- | --------- | ------------ | -------------- |
| `minimal` | `#1C1F1A` | `#FFFFFF`    | `#1C1F1A`      |
| `dark`    | `#F5A300` | `#17191A`    | `#F2F2EE`      |
| `vibrant` | `#C2185B` | `#FFF8F2`    | `#2A1A12`      |

La API valida que `--brand` sobre `--brand-bg` cumpla contraste AA para texto de botón; si no, rechaza el tema con un mensaje que dice qué color cambiar.

### 3.3 Tipografía

Una sola familia: **Onest** (Google Fonts, pesos 400, 500, 600, 700).

| Rol            | Clases Tailwind                                                    |
| -------------- | ------------------------------------------------------------------ |
| Display (hero) | `text-5xl lg:text-6xl font-bold tracking-[-0.03em] leading-[1.02]` |
| H1 de página   | `text-3xl font-bold tracking-[-0.03em]`                            |
| H2 de sección  | `text-xl font-semibold tracking-[-0.02em]`                         |
| Cuerpo         | `text-base leading-relaxed`                                        |
| Secundario     | `text-sm text-piedra`                                              |
| Precio         | `font-semibold tabular-nums`                                       |

Storefront: `theme.fontPreset` cambia la familia del menú público (`sans` = Onest, `rounded` = Nunito, `serif` = Source Serif 4). El panel siempre usa Onest.

Prohibido:

- Etiquetas en MAYÚSCULAS con tracking abierto.
- Eyebrows sobre títulos.
- Resaltar una sola palabra del titular con otro color o cursiva.
- Monospace para datos.
- Texto de línea mayor a ~75 caracteres (`max-w-prose` o `max-w-[60ch]`).

### 3.4 Espaciado, radios, bordes

- Escala de Tailwind por defecto; ritmo vertical de secciones: `py-16` (móvil) / `py-24` (desktop).
- Radios con jerarquía:
  - `rounded-xl` → contenedores (tarjetas, paneles, barra de carrito)
  - `rounded-lg` → inputs y botones
  - `rounded-full` → solo botón `+` de producto, chips y pastillas de conteo
- Bordes: `border border-linea`. En tarjetas de contenido, borde o sombra, no ambos.

### 3.5 Tailwind v4 (`src/app.css`)

```css
@import "tailwindcss";

@theme {
  --color-cal: #f3f4f1;
  --color-tinta: #1c1f1a;
  --color-piedra: #6b7068;
  --color-linea: #e3e5df;
  --color-nopal: #1f5c45;
  --color-cempasuchil: #f5a300;
  --color-error: #b42318;
  --font-sans: "Onest", system-ui, sans-serif;
}

html {
  @apply bg-cal text-tinta antialiased scroll-smooth;
}
```

### 3.6 Storefront: derivados del tema y sombra de la barra

Del tema del negocio (§3.2) se derivan tres variables en `m/[slug]/+layout.svelte`. Son mezclas de `--brand-text` y `--brand-bg`, nunca colores nuevos ni de MenusMax:

| Variable        | Valor                                              | Uso                                                    |
| --------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `--brand-muted` | `color-mix(in srgb, --brand-text 70%, --brand-bg)` | Texto secundario (descripciones, horario, notas)       |
| `--brand-line`  | `color-mix(in srgb, --brand-text 12%, --brand-bg)` | Bordes y separadores (equivalen a `linea` en el panel) |
| `--brand-tint`  | `color-mix(in srgb, --brand-text 8%, --brand-bg)`  | Fondo de píldoras, miniaturas y estados hover          |

- **Por qué 70%:** contraste de `--brand-muted` sobre `--brand-bg` medido en los tres presets: `minimal` 6.15, `dark` 8.19, `vibrant` 6.06 (AA exige 4.5). Sobre `--brand-tint` el mínimo es 5.18. Con 66% `vibrant` quedaba en 4.53 sobre el tinte, demasiado justo.
- Un tema personalizado debe volver a verificar `--brand-muted` contra `--brand-bg`; la API ya valida `--brand` sobre `--brand-bg` (§3.2).
- Solo texto ≥ 14px usa `--brand-muted`.

**Sombra de la barra del carrito** (`MenuView`): `shadow-[0_12px_28px_-10px_color-mix(in_srgb,var(--brand-text)_45%,transparent)]`. Es la receta de las superficies elevadas (§3.1: offset y desenfoque, nunca dura), a escala de barra: offset 12px, blur 28px, spread -10px. Se tinta con `--brand-text`, no con `tinta`, para que el storefront no use colores de MenusMax. La barra del carrito se suma a la lista de superficies elevadas de §3.1.

---

## 4. Componentes y patrones

La base es **shadcn-svelte** (sobre `bits-ui`) con Tailwind v4, restilado a los tokens de §3. Se pueden sumar librerías de UI y animación que sean compatibles con Svelte 5, SSR y Cloudflare Workers.

### 4.0 Primitivas shadcn-svelte

Base recomendada; se pueden instalar más del catálogo cuando hagan falta.

| Primitiva                                     | Uso                                               |
| --------------------------------------------- | ------------------------------------------------- |
| `button`, `input`, `label`, `textarea`        | Formularios y acciones                            |
| `select`, `checkbox`, `radio-group`, `switch` | Campos y modalidades                              |
| `tabs`, `toggle-group`                        | Categorías, segmented control                     |
| `dialog`, `sheet`, `alert-dialog`             | Confirmaciones, carrito móvil, formularios cortos |
| `dropdown-menu`, `popover`, `tooltip`         | Acciones secundarias                              |
| `badge`, `separator`, `skeleton`              | Estados y estructura                              |
| `sonner` (toast)                              | Confirmaciones ("Guardado")                       |

Tras instalar, se restilan a los tokens (`bg-nopal` como primary, `border-linea`, radios de §3.4). Los patrones de §4.2 describen la apariencia objetivo.

### 4.1 Componentes propios

| Componente         | Usado en                              | Responsabilidad                                                                                                                                                       |
| ------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Phone.svelte`     | Landing, `/crear`, Ajustes            | Marco de teléfono en CSS puro. `w-[300px] h-[620px] rounded-[44px] border-[10px] border-tinta bg-white overflow-hidden shadow-[0_30px_60px_-20px_rgb(28_31_26/0.35)]` |
| `MenuView.svelte`  | Storefront y todas las vistas previas | Renderiza el menú con `--brand*`. Prop `preview` deshabilita acciones                                                                                                 |
| `OrderCard.svelte` | Panel de pedidos                      | Tarjeta de pedido con su acción principal según estado                                                                                                                |

Se pueden crear más componentes propios cuando un patrón se repite en 3 o más lugares.

### 4.2 Patrones de clases

**Botón primario**

```
h-12 px-5 rounded-lg bg-nopal text-white font-semibold
hover:bg-nopal/90 disabled:opacity-50
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nopal
```

**Botón secundario**

```
h-12 px-5 rounded-lg border border-linea bg-white text-tinta font-medium hover:bg-cal
```

**Input**

```
h-12 w-full rounded-lg border border-linea bg-white px-4 text-tinta
placeholder:text-piedra outline-none focus:border-nopal focus:ring-2 focus:ring-nopal/20
aria-[invalid=true]:border-error
```

**Error de campo**: `<p class="mt-1.5 text-sm text-error">` debajo del input, enlazado con `aria-describedby`.

**Chip seleccionable** (checkbox/radio nativo oculto con `peer`)

```
h-10 px-4 rounded-full border border-linea bg-white text-sm font-medium
peer-checked:bg-nopal peer-checked:text-white peer-checked:border-nopal
peer-focus-visible:ring-2 peer-focus-visible:ring-nopal/30
```

**Segmented control** (radios): `grid grid-cols-{n} rounded-lg border border-linea p-1`; opción activa `bg-tinta text-white rounded-md`.

**Toggle** (checkbox nativo con `peer`): pista `w-11 h-6 rounded-full bg-linea peer-checked:bg-nopal`, perilla con `peer-checked:translate-x-5`.

**Expandible**: `<details>` + `<summary>` con `list-none` y marcador propio. Para variantes, motivo de rechazo y vista previa en móvil.

---

## 5. Movimiento

El movimiento responde a una acción del usuario o a un evento que exige atención, y puede dar acabado: transiciones de las primitivas (`tw-animate-css`), hover y foco con feedback, entradas suaves de superficies elevadas. Siempre con `motion-safe:` o comprobando `prefers-reduced-motion`. Se pueden usar librerías de animación si hacen falta más allá de las transiciones de Svelte.

| Evento                          | Movimiento                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Teclear el nombre del negocio   | Actualización en vivo del texto en `Phone` (sin animación; la inmediatez es el efecto) |
| Agregar producto al carrito     | Contador `scale` 1 → 1.15 → 1, 150 ms                                                  |
| Aparece la barra del carrito    | `transition:fly={{ y: 80, duration: 200 }}`                                            |
| Llega un pedido nuevo al panel  | `in:fly={{ y: -8, duration: 200 }}` + borde `cempasuchil`                              |
| Cambio de estado en seguimiento | `transition:fade` en el estado actual                                                  |
| Campos de domicilio             | `transition:slide`                                                                     |

Prohibido: animaciones en bucle, parallax y efectos que distraigan al comensal mientras elige o paga. Evita repetir la misma entrada en todas las secciones.

---

## 6. Escritura en la interfaz

- Español de México, tú, minúscula inicial salvo nombres propios.
- Los botones dicen exactamente lo que pasa, y la acción conserva su nombre en todo el flujo:
  - "Publicar menú" → estado "Publicando…" → título "Tu menú está publicado."
  - "Enviar pedido" → "Enviando…" → "Pedido enviado"
  - "Guardar cambios" → "Guardado"
- Errores: qué pasó y cómo arreglarlo, sin disculpas. Ej.: "Este producto ya no está disponible. Quítalo para continuar."
- Estados vacíos invitan a actuar. Ej.: "Aún no hay pedidos. Comparte tu QR para recibir el primero."
- Vocabulario fijo: **menú**, **producto**, **pedido**, **modalidad** (Mesa / Recoger / Domicilio), **panel**. Nunca "ítem", "orden", "storefront" o "dashboard" en la UI.

---

## 7. Flujo y pantallas

### 7.1 Negocio

| #   | Ruta            | Objetivo                                       | Acción principal                    |
| --- | --------------- | ---------------------------------------------- | ----------------------------------- |
| A   | `/`             | Empezar sin fricción                           | Form GET `nombre` → "Crear mi menú" |
| B   | `/crear`        | Armar menú + crear cuenta en un solo envío     | "Publicar menú"                     |
| C   | `/app/listo`    | Activación: primer pedido de prueba            | "Hacer un pedido de prueba"         |
| D   | `/app`          | Operar pedidos                                 | Avanzar estado con un toque         |
| E   | `/app/catalogo` | Editar productos en línea                      | Guardar por fila                    |
| F   | `/app/ajustes`  | Tema, modalidades, horarios, zonas, equipo, QR | "Guardar cambios" por sección       |
| G   | `/entrar`       | Volver al panel                                | "Entrar"                            |

**A · Landing**

```
┌──────────────────────────────────────────────────────────┐
│ MenusMax                                       Entrar    │
│                                                          │
│  Tu menú en línea,          ┌──────────────┐             │
│  con pedidos por WhatsApp.  │ Tacos El Güe…│ ← en vivo   │
│                             │ Pastor  $22  │             │
│  [ Nombre de tu negocio  ]  │ Suadero $24  │             │
│  [ Crear mi menú ]          └──────────────┘             │
│  Gratis. Sin tarjeta.                                    │
├──────────────────────────────────────────────────────────┤
│  Cómo funciona: 1 Arma tu menú · 2 Publícalo con tu QR · │
│  3 Recibe pedidos por WhatsApp                           │
│  Menú demo navegable · Una línea de precio               │
└──────────────────────────────────────────────────────────┘
```

Alineación a la izquierda. El formulario es HTML puro (`method="GET" action="/crear"`).

**B · Crear**

```
┌───────────────────────────────┬──────────────┐
│ Nombre  [Tacos El Güero     ] │ ┌──────────┐ │
│ menusmax.mx/m/tacos-el-guero  │ │ preview  │ │
│                               │ │ en vivo  │ │
│ Productos                     │ │ (sticky) │ │
│ [Pastor        ] [$22 ] ✕     │ └──────────┘ │
│ [Suadero       ] [$24 ] ✕     │              │
│ [              ] [    ] ✕     │              │
│ + Agregar producto            │              │
│                               │              │
│ Cómo entregas                 │              │
│ (Mesa) (●Recoger) (Domicilio) │              │
│ WhatsApp para avisos [      ] │              │
│ ───────────────────────────── │              │
│ Crea tu cuenta para publicar  │              │
│ [correo] [contraseña]         │              │
│ [      Publicar menú        ] │              │
└───────────────────────────────┴──────────────┘
```

Móvil: la vista previa va arriba dentro de `<details open>`. El borrador persiste en `localStorage`. Un solo POST crea cuenta, organización, negocio, sucursal, menú y productos.

**C · Listo**: QR grande, "Hacer un pedido de prueba" (primario), "Descargar QR", "Copiar enlace", enlace a "Agregar fotos a tus productos".

**D · Pedidos**: secciones apiladas Nuevos / En cocina / Listos. Navegación de 3 entradas: Pedidos · Menú · Ajustes (sidebar en desktop, tab bar en móvil). Polling 10 s.

Transiciones de estado y nombre del botón principal:

| Estado actual          | Botón              |
| ---------------------- | ------------------ |
| `pending`              | Aceptar            |
| `accepted`             | Empezar a preparar |
| `preparing`            | Marcar listo       |
| `ready` (recoger/mesa) | Entregado          |
| `ready` (domicilio)    | Enviar a domicilio |
| `out_for_delivery`     | Entregado          |

"Rechazar" vive en un `<details>` con campo de motivo (o un `AlertDialog` si se prefiere confirmar).

### 7.2 Comensal

| #   | Ruta                    | Objetivo                | Acción principal                           |
| --- | ----------------------- | ----------------------- | ------------------------------------------ |
| H   | `/m/[slug]` (`?mesa=n`) | Elegir productos        | "+" y "Ver pedido"                         |
| I   | `/m/[slug]/pedido`      | Enviar pedido           | "Enviar pedido · $total"                   |
| J   | `/pedido/[token]`       | Saber cuándo está listo | "Llamar al negocio" (solo si hay problema) |

**H · Menú**

```
┌────────────────────────┐
│ Tacos El Güero         │
│ Abierto · cierra 23:00 │
│ (Tacos)(Bebidas)(Postr)│ ← sticky, anclas
│ Pastor          $22 (+)│
│ Suadero         $24 (+)│
│ Gringa ▸ elige tortilla│ ← <details>
│                        │
│ ┌────────────────────┐ │
│ │Ver pedido  ③  $240 │ │ ← fixed bottom
│ └────────────────────┘ │
└────────────────────────┘
```

El horario se ve antes de agregar nada. Si el negocio está cerrado, los botones `+` se deshabilitan y la cabecera dice a qué hora abre.

**I · Pedido (checkout)**: resumen con −/+, modalidad (fija y oculta si viene `?mesa`), nombre, teléfono, dirección solo para domicilio, "Pagas en efectivo al recibir", "Recordar mis datos", botón fijo "Enviar pedido · $240". Idempotency key en input oculto generado en `load`.

**J · Seguimiento**: línea de estado vertical (`<ol>`, es una secuencia real), polling 10 s que se detiene en estados finales.

---

## 8. Arquitectura del frontend (`apps/web/src`)

```text
app.css
routes/
├── +layout.svelte
├── (marketing)/+page.svelte
├── (auth)/entrar/+page.svelte · +page.server.ts
├── crear/+page.svelte · +page.server.ts
├── app/+layout.server.ts · +layout.svelte
├── app/+page.svelte · +page.server.ts
├── app/listo/+page.svelte · +page.server.ts
├── app/catalogo/+page.svelte · +page.server.ts
├── app/ajustes/+page.svelte · +page.server.ts
├── m/[slug]/+layout.server.ts · +layout.svelte · +page.svelte
├── m/[slug]/pedido/+page.svelte · +page.server.ts
└── pedido/[token]/+page.svelte · +page.server.ts
lib/
├── cart.svelte.ts
├── money.ts
├── server/demo.ts      (TEMPORAL: datos mock)
├── server/api.ts       (cuando exista la API)
├── images.ts
└── components/Phone.svelte · MenuView.svelte · OrderCard.svelte
```

---

## 9. Reglas de código Svelte

- Svelte 5 con Runes: `$state`, `$derived`, `$props`. `$effect` solo para sincronizar con algo externo (storage, intervalos).
- Eventos como atributos (`onclick`), contenido con `{#snippet}` / `{@render}`.
- Mutaciones = form actions de SvelteKit + `use:enhance`. Sin `fetch` manual desde componentes para mutar.
- Polling con `depends()` + `invalidate()` dentro de un `$effect` que limpia su `setInterval`.
- **Nunca estado mutable a nivel de módulo** (se compartiría entre usuarios en SSR). El carrito es `new Cart()` creado en `m/[slug]/+layout.svelte` y entregado con `setContext`.
- Dinero siempre en centavos; formato con `Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })` en `lib/money.ts`.
- shadcn-svelte y librerías de UI/animación permitidas (compatibles con Svelte 5, SSR y Workers). Sin librerías de estado global: el estado compartido va en clases `.svelte.ts` con contexto.
- Imports con `#lib/...` (SvelteKit 3 eliminó `$lib`).
- `localStorage` / `sessionStorage` siempre dentro de `try/catch`.

---

## 10. Piso de calidad

- Mobile-first; probado a 360px de ancho.
- Áreas táctiles ≥ 44px.
- Foco visible en todo elemento interactivo.
- `prefers-reduced-motion` respetado.
- Contraste AA en ambos sistemas de color (MenusMax y tema del negocio).
- Imágenes de producto con `loading="lazy"`, `width`/`height` declarados y `alt` con el nombre del producto.
- El menú público funciona sin JavaScript para leer; JS solo es necesario para el carrito.

---

## 11. Lista negra

- Login de comensal.
- Wizards de varios pasos.
- Modales para productos simples o para lo que cabe en la página.
- Analíticas como página de inicio del panel.
- Texto con degradado, sombras duras, tarjetas idénticas en rejilla como decoración.
- Etiquetas en mayúsculas, eyebrows, numeración decorativa, flechas en botones.
- Color de marca MenusMax dentro del menú público.
- Dependencias que no funcionan en SSR o en Cloudflare Workers, o que pesan mucho en el menú público.
