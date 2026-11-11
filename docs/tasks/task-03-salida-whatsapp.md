# Task 03 — Ofrecer salida a WhatsApp para el pedido

**Prioridad:** P0
**Categoría:** Funcionalidad
**Depende de:** task-01, task-02

## Contexto

La landing y `apps/web/src/routes/app/listo/+page.svelte` prometen pedidos por WhatsApp. La action de `apps/web/src/routes/m/[slug]/pedido/+page.server.ts` solo redirige a seguimiento; no aparece enlace de WhatsApp ni se prepara un mensaje. La suite verifica el enlace sin abrirlo ni enviar mensajes.

## Objetivo

Ofrecer una salida explícita y verificable a WhatsApp con el pedido simulado y el número del negocio, sin afirmar que ya se envió un mensaje.

## Archivos involucrados

- `apps/web/src/routes/m/[slug]/pedido/+page.server.ts`
- `apps/web/src/routes/pedido/[token]/+page.server.ts`
- `apps/web/src/routes/pedido/[token]/+page.svelte`
- `apps/web/src/lib/server/demo.ts`
- `e2e/flujos.spec.ts`

## Pasos sugeridos

1. Utilizar el número y el resumen del pedido proveniente del mock tipado de task-02; formar un enlace de WhatsApp válido y codificar correctamente el texto.
2. Mostrar una acción accesible en el seguimiento que explique que abre WhatsApp; conservar el seguimiento y permitir al usuario decidir si envía el mensaje.
3. Controlar número ausente y presentar feedback preciso. No realizar envíos automáticos en las pruebas.

## Criterios de aceptación

- [ ] El enlace ofrece destinatario y resumen coherentes con el pedido; ningún test envía un mensaje externo.
- [ ] Se reactiva y pasa `e2e/flujos.spec.ts › el pedido ofrece salida a WhatsApp sin enviar mensajes durante la prueba` en móvil y desktop.
- [ ] Los tests de seguimiento de task-02 siguen pasando.

## Fuera de alcance

API de WhatsApp, automatización de envío, confirmación de entrega de mensajes o cualquier servicio remoto.
