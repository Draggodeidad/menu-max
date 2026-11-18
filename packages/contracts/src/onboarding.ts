import { z } from "zod";
import { BranchModes, E164Phone, TableCount } from "./businesses";
import { PriceCents } from "./catalog";

// Onboarding en un solo envío (T20, ADR-008, ADR-013): `/crear` → `POST /v1/onboarding`.

/** Header obligatorio: la misma llave y el mismo cuerpo devuelven la misma respuesta (24 h). */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
export const IdempotencyKey = z.uuid({ message: "Envía un Idempotency-Key con formato UUID." });

/**
 * Tope fijo de productos del alta, solo para acotar el cuerpo. El tope real es `max_products`
 * del plan `free`, leído de `plans` por el servicio: el menú inicial debe caber en el plan al
 * que pasará la cuenta al terminar la prueba.
 */
export const MAX_ONBOARDING_PRODUCTS = 200;

const BusinessName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\p{Cc}]+$/u);

const ProductName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}]+$/u);

export const OnboardingProductInput = z.strictObject({ name: ProductName, priceCents: PriceCents });

/**
 * Alta completa. `tableCount` es obligatorio si `modes.table` es `true` (lo valida el servicio,
 * igual que al crear una sucursal). Con sesión (reanudación), `account.email` debe ser el de la
 * sesión y la contraseña no se usa.
 */
export const OnboardingInput = z.strictObject({
  businessName: BusinessName,
  products: z.array(OnboardingProductInput).min(1).max(MAX_ONBOARDING_PRODUCTS),
  modes: BranchModes,
  tableCount: TableCount.optional(),
  alertWhatsapp: E164Phone.optional(),
  account: z.strictObject({
    email: z.email(),
    password: z.string().min(10).max(128),
  }),
});
export type OnboardingInput = z.infer<typeof OnboardingInput>;

/** Lo que WEB necesita para `/app/listo`: la organización, su sucursal y el enlace del menú. */
export const OnboardingDto = z
  .strictObject({
    orgId: z.uuidv7(),
    branchId: z.uuidv7(),
    menuSlug: z.string(),
    menuUrl: z.url(),
  })
  .meta({ id: "OnboardingDto" });
export type OnboardingDto = z.infer<typeof OnboardingDto>;

export const ACCOUNT_ALREADY_EXISTS_MESSAGE =
  "Ya tienes una cuenta con este correo. Entra para publicar tu menú.";
