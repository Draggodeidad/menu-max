/// <reference types="@cloudflare/workers-types" />

import type { ErrorCode } from "@menu-max/contracts";
import type { SesionDemo } from "#lib/server/sesion.js";

declare global {
  namespace Cloudflare {
    interface Env {
      API: Fetcher;
      INTERNAL_TOKEN: string;
    }
  }

  namespace App {
    interface Error {
      code?: ErrorCode;
    }

    interface Locals {
      // TEMPORAL: sesión simulada; null si este navegador no ha entrado.
      session: SesionDemo | null;
    }
  }
}

export {};
