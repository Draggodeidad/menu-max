# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Negocios de comida en México que necesitan publicar su menú y recibir pedidos.
- Comensales que consultan el menú y hacen un pedido sin crear una cuenta.

## Product Purpose

MenusMax busca que los negocios publiquen un menú digital y reciban pedidos por WhatsApp. Sus dos resultados principales son la publicación del menú por el negocio y el envío de pedidos por los comensales.

## Operating Context

El negocio arma su menú antes de crear una cuenta, lo publica y comparte su enlace o código QR. El comensal consulta productos y realiza un pedido como invitado; las modalidades previstas son mesa, recoger y domicilio. El negocio administra sus pedidos, productos y ajustes desde un panel.

## Capabilities and Constraints

- El flujo de creación previsto reúne menú y cuenta en una sola página; no se usa un asistente de varios pasos.
- El menú público pertenece visualmente al negocio y debe poder leerse sin JavaScript.
- La API es responsable de precios, totales, permisos y estados.
- El repositorio está en desarrollo: su README indica que la base no incluye todavía base de datos, autenticación ni lógica de negocio. Los flujos descritos son objetivos del producto, no funcionalidades cuya implementación completa esté confirmada.

## Brand Commitments

El nombre del producto es MenusMax. La interfaz usa español de México, trata al usuario de tú y emplea los términos menú, producto, pedido, modalidad y panel.

## Evidence on Hand

- `DESIGN.md` describe el MVP, sus principios y los flujos previstos.
- `src/routes/` contiene las rutas existentes de la página inicial y creación; su presencia no demuestra que los flujos completos estén implementados.

## Product Principles

1. Permitir que el negocio construya valor antes de pedirle una cuenta.
2. Facilitar el pedido al comensal sin exigir registro.
3. Reducir los pasos que separan al negocio de publicar y al comensal de pedir.
4. Mantener coherencia entre la vista previa del negocio y su menú público.
5. Dejar las decisiones de negocio y los cálculos definitivos en el servidor.

## Accessibility & Inclusion

El proyecto exige contraste AA, foco visible, respeto por movimiento reducido, áreas táctiles de al menos 44 px y una experiencia adaptable desde 360 px.
