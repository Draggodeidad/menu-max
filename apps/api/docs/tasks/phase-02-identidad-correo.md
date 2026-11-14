# Fase B2 — Identidad y correo

> Planeación del backend (versionada en git).
> **Criterio para cerrar la fase:** con un usuario de prueba, se recibe un correo real, el clic deja la sesión verificada y el reset de contraseña funciona; reset y reenvío no revelan si un correo existe.
> **Orden de ejecución:** T07 → T10, en orden numérico.
> **Nota:** las pantallas de `apps/web` (`/entrar`, verificar correo, restablecer contraseña) no se hacen aquí. Las que no están en `DESIGN.md §7` deben agregarse primero a ese documento.

---

## T07 — Better Auth sobre D1 y sesiones

**Fase:** B2 · **Depende de:** T02, T03, T05 · **ADR:** 005 · **Rama sugerida:** `feat/t07-better-auth`

### Objetivo

La API puede iniciar y cerrar sesión con correo y contraseña, y cada petición conoce a su usuario a partir de la cookie que reenvía WEB.

### Alcance

- `better-auth` con versión exacta fijada en `package.json`.
- Esquema de identidad generado con el CLI de Better Auth hacia `packages/database/src/schema/auth.ts`, con tablas en plural (`usePlural: true` en el adaptador Drizzle). Se agrega la columna `users.email_status` (`'ok' | 'undeliverable'`, default `'ok'`). Ids con UUIDv7 a través de la opción de generación de ids de Better Auth (verifica el nombre de la opción en la versión instalada).
- Primera migración (`0001`) con esas tablas.
- `modules/auth/auth.ts`: `createAuth(env)` **por petición** con:
  - `database: drizzleAdapter(db, { provider: 'sqlite', usePlural: true, schema })`;
  - `baseURL: env.WEB_ORIGIN`, `basePath: '/v1/auth'`, `trustedOrigins: [env.WEB_ORIGIN]`, `secret: env.BETTER_AUTH_SECRET`;
  - `emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128, requireEmailVerification: false }`;
  - `session: { expiresIn: 7 días, updateAge: 1 día }`;
  - cookies seguras fuera de development;
  - rate limit interno de Better Auth **desactivado** (en memoria no sirve en Workers; usamos ADR-010 en T09);
  - plugin `haveIBeenPwned`.
- `modules/auth/auth.routes.ts`: monta el handler de Better Auth en `/v1/auth/*` con **lista permitida** de rutas. Solo se reenvían: iniciar sesión con correo, cerrar sesión, obtener sesión, verificar correo, reenviar verificación, solicitar reset, restablecer contraseña y cambiar contraseña. Todo lo demás, **registro incluido**, responde `404`. El alta de cuentas solo ocurre desde `POST /v1/onboarding` (T20) y al aceptar una invitación (T13), llamando `auth.api.signUpEmail` desde el servidor.
- `middleware/session.ts`: `auth.api.getSession({ headers })` y deja `c.var.user` y `c.var.session` (o `null`).
- `middleware/require-auth.ts`: sin sesión → `AUTH_REQUIRED`.
- `GET /v1/me` → `{ user: { id, email, name, emailVerified } }` (las membresías se agregan en T11).
- Esquemas `MeDto` y entradas de auth en `packages/contracts`.

### Fuera de alcance

- Envío de correos (T08, T10), Turnstile y bloqueo de login (T09).
- Login social, 2FA, passkeys.
- `hooks.server.ts` y pantallas de `apps/web`.

### Archivos esperados

- `packages/database/src/schema/auth.ts`, `packages/database/migrations/0001_*.sql`
- `apps/api/src/modules/auth/{auth.ts,auth.routes.ts,auth.service.ts,auth.test.ts}`
- `apps/api/src/middleware/{session.ts,require-auth.ts}`
- `packages/contracts/src/auth.ts`

### Endpoints

| Método | Ruta                           | Guardas       | Entrada     | Salida      |
| ------ | ------------------------------ | ------------- | ----------- | ----------- |
| *      | `/v1/auth/*` (lista permitida) | interno       | Better Auth | Better Auth |
| GET    | `/v1/me`                       | `requireAuth` | —           | `MeDto`     |

### Variables de entorno y bindings

- `BETTER_AUTH_SECRET` (secreto, ≥ 32 caracteres), `WEB_ORIGIN` (`http://localhost:5173` en dev). Agregar a `env.ts`, `.dev.vars.example` y `.env.example`.

### Pruebas requeridas

- [ ] Usuario creado con `auth.api.signUpEmail` en el setup puede iniciar sesión; la respuesta trae `set-cookie` con `HttpOnly` y `SameSite=Lax` (y `Secure` fuera de development).
- [ ] `GET /v1/me` con la cookie → usuario; sin cookie → 401.
- [ ] Cerrar sesión invalida la cookie.
- [ ] `POST /v1/auth/sign-up/email` (o la ruta equivalente de la versión instalada) → 404.
- [ ] Contraseña de 9 caracteres o filtrada → rechazo con `VALIDATION_FAILED` o el error mapeado.
- [ ] Cambiar contraseña revoca las demás sesiones.
- [ ] Un `origin` distinto de `WEB_ORIGIN` es rechazado en mutaciones.

### Criterios de aceptación

- [ ] La migración `0001` aplica desde cero en local y en tests.
- [ ] Ningún módulo fuera de `modules/auth` importa `better-auth`.

### Notas

- Mide el tiempo de CPU del hashing en `wrangler dev`; si se acerca al límite del plan, avísalo en el PR.

---

## T08 — Cola de trabajos y puerto `Mailer`

**Fase:** B2 · **Depende de:** T03 · **ADR:** 020, 011 · **Rama sugerida:** `feat/t08-jobs-mailer`

> ADR-020 (`Aceptado`) reemplaza a ADR-009: el proveedor es Resend por `fetch`, sin SDK.

### Objetivo

La API puede encolar trabajos tipados, consumirlos con reintentos y DLQ, y enviar correos a través de un puerto intercambiable.

### Alcance

- `wrangler.jsonc` por entorno: productor `JOBS` (cola `menusmax-jobs`), productor `JOBS_DLQ` (cola `menusmax-jobs-dlq`), consumidor de `menusmax-jobs` con `max_batch_size: 10`, `max_retries: 5`, `dead_letter_queue: 'menusmax-jobs-dlq'`. Sin binding de correo.
- `packages/contracts/src/jobs.ts`: unión discriminada `JobMessage` con `email.send` = `{ type, id (uuid), to, template, data }`, donde `template` es `'verify-email' | 'reset-password' | 'invitation' | 'password-changed'`.
- `infrastructure/jobs.ts`: `enqueue(env, message)` valida con Zod antes de `JOBS.send`.
- `src/index.ts` exporta `queue(batch, env, ctx)`:
  - mensaje inválido → se reenvía a `JOBS_DLQ`, `ack()` y `log.error`;
  - despacha por `type` a un registro de handlers;
  - error transitorio → `retry({ delaySeconds })` con backoff (30 s, 60 s, 120 s, 240 s, 480 s);
  - error permanente → `log.error` y `ack()`.
- `infrastructure/mailer/`:
  - `mailer.ts`: interfaz `Mailer` con `send({ to, template, data })` y `createMailer(env)` que elige adaptador por `ENVIRONMENT`;
  - `resend.ts`: adaptador con `fetch` a `POST https://api.resend.com/emails`, `AbortSignal.timeout(10_000)` y errores clasificados (`400`/`422` permanentes; el resto transitorios);
  - `console.ts`: solo development; imprime destinatario, asunto y enlace en la terminal de `wrangler dev`;
  - `templates.ts`: funciones puras que devuelven `{ subject, text, html }` en español de México, HTML simple sin imágenes remotas ni tracking.
- Handler `email.send` que usa `Mailer`.

### Fuera de alcance

- Quién encola cada correo (T10, T13).
- Outbox y WhatsApp (T21, T24).
- Rebotes y quejas (webhook de Resend; pendiente en ADR-020).

### Archivos esperados

- `packages/contracts/src/jobs.ts`
- `apps/api/src/infrastructure/jobs.ts`, `apps/api/src/infrastructure/mailer/{mailer.ts,resend.ts,console.ts,templates.ts}`
- `apps/api/src/jobs/{consumer.ts,email.handler.ts}` y sus pruebas

### Variables de entorno y bindings

- `EMAIL_FROM` (`MenusMax <no-reply@mail.imanolantonio.dev>`) y secreto `RESEND_API_KEY`. Bindings `JOBS`, `JOBS_DLQ`. Agregar a `env.ts`, `.dev.vars.example` y `.env.example`.
- El dominio emisor y la API key los da de alta un humano en Resend (SPF, DKIM, DMARC). No ejecutes comandos remotos.

### Pruebas requeridas

- [ ] `enqueue` rechaza un mensaje que no cumple el esquema.
- [ ] El consumidor envía un mensaje inválido a `JOBS_DLQ` sin reintentar.
- [ ] Error transitorio del mailer → `retry` con el retraso esperado; error permanente → `ack`.
- [ ] Cada plantilla produce asunto, texto y HTML sin `undefined` y con el enlace recibido.
- [ ] En development se usa el adaptador de consola.

### Criterios de aceptación

- [ ] En local, encolar un `email.send` imprime el correo en la terminal.
- [ ] Ningún archivo fuera de `infrastructure/mailer` usa `env.RESEND_API_KEY` ni llama a Resend.

### Notas

- Un correo de auth duplicado por reentrega de la cola es aceptable; no se deduplica (ADR-011).

---

## T09 — Anti-abuso: cuotas, rate limit, Turnstile y filtros de correo

**Fase:** B2 · **Depende de:** T07 · **ADR:** 008, 010 · **Rama sugerida:** `feat/t09-anti-abuso`

> El Turnstile en login tras 3 fallos depende de ADR-010 (`Propuesto` en esa parte): no lo implementes hasta que esté aceptado. El bloqueo de 5 fallos en 15 min sí está aceptado.

### Objetivo

Existen las piezas reutilizables de anti-abuso y ya protegen el inicio de sesión.

### Alcance

- Tabla `rate_counters (key text, window_start integer, count integer, primary key (key, window_start))` y migración.
- `shared/rate-counters.ts`: `hit(db, key, windowMs, limit)` con `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`; devuelve `{ allowed, remaining, retryAfterMs }`.
- Binding `ratelimits` por entorno con tres grupos (valores provisionales, ajustables en el PR): `RL_AUTH` 10/60 s, `RL_PUBLIC` 60/60 s, `RL_PRIVATE` 300/60 s.
- `middleware/rate-limit.ts`: `rateLimit('auth' | 'public' | 'private')` con llave `ip + grupo`; excedido → `RATE_LIMITED` con `Retry-After`. Se monta en `app.ts` según el prefijo de ruta.
- `infrastructure/turnstile.ts`: `verifyTurnstile(env, token, clientIp)` contra `siteverify` con timeout de 10 s; inválido o reutilizado → `AppError('VALIDATION_FAILED', …, { turnstileToken: [...] })`. Convención para todo el proyecto: el token viaja en el header `x-turnstile-token`, nunca en el body (así no choca con esquemas estrictos ni con los de Better Auth).
- `shared/email-checks.ts`:
  - normalización (trim, minúsculas, ≤ 254);
  - lista de dominios desechables en `shared/disposable-domains.ts`, generada por `scripts/update-disposable-domains.ts` (fuente documentada en el script);
  - chequeo MX por DNS-over-HTTPS (`https://cloudflare-dns.com/dns-query`, `accept: application/dns-json`); sin MX se acepta registro A (MX implícito); resultado guardado 24 h en `email_domain_checks (domain, has_mail, checked_at)`;
  - `assertDeliverableEmail(deps, email)` lanza `VALIDATION_FAILED` con mensaje accionable.
- Bloqueo de login: antes de reenviar a Better Auth el inicio de sesión, `hit('login-fail:' + correo + ':' + ip, 15 min, 5)`; tras una respuesta de credenciales inválidas se incrementa. Excedido → `RATE_LIMITED`.
- `scheduled` en `src/index.ts` con un Cron diario (`0 9 * * *`, 3:00 en Ciudad de México) que borra `rate_counters` vencidos y `email_domain_checks` de más de 7 días.

### Fuera de alcance

- Aplicar las cuotas de registro, pedidos e invitaciones (se aplican en T13, T20 y T21 usando estas piezas).
- Turnstile en login (ver nota).

### Variables de entorno y bindings

- `TURNSTILE_SECRET_KEY` (en tests y dev, la clave de prueba de Cloudflare). Bindings `RL_AUTH`, `RL_PUBLIC`, `RL_PRIVATE`. Cron diario.

### Pruebas requeridas

- [ ] `hit` permite exactamente `limit` llamadas en la ventana y la siguiente no.
- [ ] Dos ventanas distintas no se mezclan.
- [ ] Turnstile con la clave de prueba que siempre pasa → ok; con la que siempre falla → `VALIDATION_FAILED`.
- [ ] Dominio desechable → rechazo; dominio sin MX ni A (DoH simulado) → rechazo; resultado guardado y reutilizado.
- [ ] Sexto intento fallido de login en 15 min → 429, aunque la contraseña sea correcta.
- [ ] El Cron borra contadores vencidos.

### Criterios de aceptación

- [ ] Ninguna llamada real a DoH ni a Turnstile en pruebas.
- [ ] Mensajes en español de México: "Usa un correo que revises seguido.", "Revisa que el correo esté bien escrito."

---

## T10 — Verificación de correo, reset y cambio de contraseña

**Fase:** B2 · **Depende de:** T07, T08, T09 · **ADR:** 005, 008 · **Rama sugerida:** `feat/t10-verificacion-reset`

### Objetivo

El usuario recibe y usa enlaces de verificación y de reset sin que la API revele qué correos existen.

### Alcance

- Configuración de Better Auth:
  - `emailVerification`: `sendOnSignUp: true`, `autoSignInAfterVerification: true`, vigencia 24 h, `sendVerificationEmail` → `enqueue(email.send, 'verify-email')`.
  - `emailAndPassword.sendResetPassword` → `enqueue(email.send, 'reset-password')`, vigencia 1 h, revocar sesiones al restablecer.
  - Tras cambiar o restablecer contraseña → `enqueue(email.send, 'password-changed')`.
- **Los enlaces apuntan a WEB, no a la API:** se construyen con el `token` que entrega Better Auth: `${WEB_ORIGIN}/verificar-correo?token=…` y `${WEB_ORIGIN}/restablecer?token=…`. WEB los resolverá llamando a la API por binding.
- Cuotas (con `rate-counters` de T09):
  - reenviar verificación: 1 cada 60 s y 5 por día por usuario;
  - solicitar reset: 3 por hora por correo normalizado y Turnstile obligatorio.
- Respuestas sin enumeración: solicitar reset y reenviar verificación responden siempre `202 { message: "Si el correo existe, te enviamos un enlace." }`, incluso si la cuota se excedió para un correo inexistente.
- `GET /v1/me` incluye `emailVerified` actualizado.

### Fuera de alcance

- Pantallas `/verificar-correo` y `/restablecer` en web (requieren agregarse a `DESIGN.md §7` antes).
- Rebotes (`email_status`): pendiente de ADR-009.

### Endpoints

| Método | Ruta                                             | Guardas                                        | Entrada                  | Salida                           |
| ------ | ------------------------------------------------ | ---------------------------------------------- | ------------------------ | -------------------------------- |
| GET    | `/v1/auth/verify-email?token=` (Better Auth)     | interno                                        | token                    | sesión + redirección configurada |
| POST   | `/v1/auth/send-verification-email` (Better Auth) | `requireAuth`, cuota                           | —                        | 202                              |
| POST   | `/v1/auth/request-password-reset` (Better Auth)  | Turnstile en header `x-turnstile-token`, cuota | `{ email }`              | 202                              |
| POST   | `/v1/auth/reset-password` (Better Auth)          | interno                                        | `{ token, newPassword }` | 200                              |

> Los nombres exactos de las rutas dependen de la versión de Better Auth; usa los de la versión instalada y actualiza la lista permitida de T07.

### Pruebas requeridas

- [ ] El alta encola un `verify-email` con un enlace a `WEB_ORIGIN`.
- [ ] Verificar con token válido marca `emailVerified` y devuelve sesión; token vencido o reutilizado → error.
- [ ] Reset con correo existente y con correo inexistente producen la misma respuesta y el mismo tiempo aproximado (sin consultas extra visibles).
- [ ] Sexto reenvío del día → bloqueado sin revelar existencia.
- [ ] Restablecer contraseña revoca todas las sesiones previas.

### Criterios de aceptación

- [ ] En local, el enlace impreso por el adaptador de consola verifica la cuenta al resolverse vía API.
- [ ] Ningún correo contiene tokens de sesión ni datos además del enlace.
