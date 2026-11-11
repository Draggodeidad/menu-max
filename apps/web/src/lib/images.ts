/**
 * Única fuente de la imagen de producto de ejemplo.
 * Cuando la API entregue fotos reales, los productos traerán su propia `imagen`
 * y esta constante solo queda como respaldo en `ProductImage.svelte`.
 */
export const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#e3e5df"/></svg>',
  );
