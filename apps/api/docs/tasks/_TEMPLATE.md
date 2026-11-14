## TNN — Título corto en imperativo

**Fase:** BN · **Depende de:** TNN · **ADR:** NNN · **Rama sugerida:** `feat/tNN-slug`

### Objetivo

Una o dos frases: qué existe al terminar que hoy no existe.

### Alcance

- Qué entra, en reglas concretas.

### Fuera de alcance

- Qué NO se hace en esta task (para que el agente no se extienda).

### Archivos esperados

- `ruta/archivo.ts` — para qué.

### Endpoints

| Método | Ruta | Guardas | Entrada | Salida |
| ------ | ---- | ------- | ------- | ------ |

### Datos

- Tablas o columnas nuevas, índices y migración.

### Variables de entorno y bindings

- Nombre, para qué y dónde se declara (`env.ts`, `.dev.vars.example`, `.env.example`, `wrangler.jsonc`).

### Pruebas requeridas

- [ ] Caso feliz
- [ ] Sin sesión → 401
- [ ] Otra organización → 404
- [ ] Rol sin permiso → 403
- [ ] Casos de abuso o borde específicos

### Criterios de aceptación

- [ ] Verificable sin leer el código (comando, respuesta HTTP, comportamiento).

### Notas

- Decisiones abiertas, riesgos o dudas para el humano.
