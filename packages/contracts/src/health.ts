import { z } from "zod";

export const Environment = z.enum(["development", "staging", "production"]);

export const HealthResponse = z.strictObject({
  status: z.literal("ok"),
  environment: Environment,
  db: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
