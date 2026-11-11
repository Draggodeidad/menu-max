// See https://svelte.dev/docs/kit/types#app.d.ts
import type { SesionDemo } from "#lib/server/sesion.js";

declare global {
  namespace App {
    interface Locals {
      // TEMPORAL: sesión simulada; null si este navegador no ha entrado.
      session: SesionDemo | null;
    }
  }
}

export {};
