# Menu Max

Base de monorepo para una aplicación web SvelteKit y una API Hono como monolito modular. Es un punto de partida: no incluye base de datos, autenticación ni lógica de negocio.

## Requisitos

- Node.js 24 o 26 y pnpm 11.4.0.

## Comenzar

```sh
pnpm install --frozen-lockfile
pnpm dev
```

La web inicia en <http://localhost:5173> y la API en <http://localhost:3001>. La API expone `GET /health`; se puede cambiar su puerto con `PORT`.

## Comandos

- `pnpm build`: compila ambas aplicaciones.
- `pnpm check`: comprueba TypeScript y Svelte.
- `pnpm lint`: ejecuta Oxlint.
- `pnpm format` / `pnpm format:check`: aplica o comprueba el formato con Oxfmt.
- `pnpm test`: ejecuta las pruebas existentes.
- `pnpm validate`: ejecuta todas las comprobaciones y la compilación, como en CI.

## Estructura

- `apps/web`: aplicación SvelteKit.
- `apps/api`: proceso único de API; cada dominio debe vivir en `src/modules`, con sus rutas y lógica propias. `src/app.ts` compone los módulos y `src/server.ts` arranca el servidor.

Oxlint analiza JavaScript y TypeScript, incluidos los bloques compatibles de Svelte; `svelte-check` complementa la validación de componentes. Oxfmt utiliza soporte basado en Prettier para archivos Svelte. El adaptador automático de SvelteKit sirve para desarrollo y plataformas compatibles; antes de desplegar se debe seleccionar y configurar el adaptador adecuado para la plataforma elegida.

## Calidad y commits

Oxlint rechaza errores, patrones sospechosos y problemas de rendimiento, además de reglas explícitas de TypeScript. `svelte-check` sigue siendo necesario para validar los componentes. Oxfmt se encarga del estilo; no se activan todas las reglas restrictivas o pedantes indiscriminadamente.

Al instalar las dependencias, Lefthook instala los hooks de Git: antes de un commit comprueba el formato, el lint y los tipos de todo el proyecto; `commit-msg` valida el mensaje con Conventional Commits. Para reinstalarlos manualmente, ejecuta `pnpm exec lefthook install`. El CI comprueba también los mensajes de los commits de cada PR; los hooks locales se pueden omitir, por lo que la protección de ramas y la obligatoriedad del CI deben configurarse en el repositorio remoto.

Usa mensajes como `feat(api): agregar menú` o `fix(web): corregir navegación`. La primera línea tiene un máximo de 100 caracteres. Usa ramas con los prefijos `feat/`, `fix/`, `docs/` o `chore/` e integra los cambios mediante PR.
