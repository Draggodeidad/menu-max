import type { ErrorCode } from "@menu-max/contracts";
import { AppError } from "../errors";

/** Resultado de una política ABAC: se evalúa sin I/O y se aplica antes de escribir. */
export type PolicyResult =
  | { allowed: true }
  | { allowed: false; code: ErrorCode; message: string | undefined };

export function allow(): PolicyResult {
  return { allowed: true };
}

/** `message` en español de México; sin él se usa el mensaje del catálogo para `code`. */
export function deny(code: ErrorCode, message?: string): PolicyResult {
  return { allowed: false, code, message };
}

export function assertAllowed(result: PolicyResult): void {
  if (!result.allowed) throw new AppError(result.code, result.message);
}
