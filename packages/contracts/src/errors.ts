import { z } from "zod";

// Catálogo único de errores (apps/api/AGENTS.md §9). No agregues códigos sin avisar en el PR.
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "AUTH_REQUIRED",
  "EMAIL_NOT_VERIFIED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_TRANSITION",
  "BUSINESS_RULE",
  "PLAN_LIMIT_REACHED",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_HTTP_STATUS = {
  VALIDATION_FAILED: 400,
  AUTH_REQUIRED: 401,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_TRANSITION: 422,
  BUSINESS_RULE: 422,
  PLAN_LIMIT_REACHED: 402,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const satisfies Record<ErrorCode, number>;

export const ErrorResponse = z.strictObject({
  code: ErrorCode,
  message: z.string(),
  requestId: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
