import { z } from "zod";
import { MembershipDto } from "./organizations";

export const EMAIL_STATUSES = ["ok", "undeliverable"] as const;

const Email = z.email();
const NewPassword = z.string().min(10).max(128);
const CurrentPassword = z.string().min(1).max(128);
const Token = z.string().min(1);
const Callback = z.string().min(1).optional();

export const SignInInput = z.strictObject({
  email: Email,
  password: CurrentPassword,
  callbackURL: Callback,
  rememberMe: z.boolean().optional(),
});
export const SignOutInput = z.strictObject({}).optional();
// Los enlaces de los correos apuntan a WEB, que resuelve el token llamando a la API: no hay
// redirecciones desde la API.
export const VerifyEmailQuery = z.strictObject({ token: Token });
// El correo sale de la sesión; el cliente no lo elige.
export const SendVerificationEmailInput = z.strictObject({});
export const RequestPasswordResetInput = z.strictObject({ email: Email });
export const ResetPasswordQuery = z.strictObject({ token: Token.optional() });
export const ResetPasswordInput = z.strictObject({
  newPassword: NewPassword,
  token: Token.optional(),
});
export const ChangePasswordInput = z.strictObject({
  currentPassword: CurrentPassword,
  newPassword: NewPassword,
  revokeOtherSessions: z.boolean().optional(),
});
export const GetSessionQuery = z.strictObject({
  disableCookieCache: z.literal("true").optional(),
  disableRefresh: z.literal("true").optional(),
});

const MeUser = z.strictObject({
  id: z.uuidv7(),
  email: Email,
  name: z.string(),
  emailVerified: z.boolean(),
});

/** Usuario de la sesión y sus membresías activas (ADR-006). */
export const MeDto = z
  .strictObject({ user: MeUser, memberships: z.array(MembershipDto) })
  .meta({ id: "MeDto" });
export type MeDto = z.infer<typeof MeDto>;

const AuthUserDto = MeUser.extend({
  image: z.string().nullish(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).meta({ id: "AuthUserDto" });

export const SignInDto = z.strictObject({
  redirect: z.boolean(),
  token: Token,
  url: z.string().nullish(),
  user: AuthUserDto,
});
export const SignOutDto = z.strictObject({ success: z.literal(true) });
export const VerifyEmailDto = z.strictObject({
  status: z.literal(true),
  user: AuthUserDto.nullable(),
});
/** Respuesta única de reenvío y reset: no revela si el correo existe (ADR-008). */
export const LINK_SENT_MESSAGE = "Si el correo existe, te enviamos un enlace.";
export const LinkSentDto = z
  .strictObject({ message: z.literal(LINK_SENT_MESSAGE) })
  .meta({ id: "LinkSentDto" });
export type LinkSentDto = z.infer<typeof LinkSentDto>;
export const ResetPasswordDto = z.strictObject({ status: z.literal(true) });
export const ChangePasswordDto = z.strictObject({ token: Token, user: AuthUserDto });
export const GetSessionDto = z
  .strictObject({
    user: AuthUserDto,
    session: z.strictObject({
      id: z.uuidv7(),
      userId: z.uuidv7(),
      token: Token,
      expiresAt: z.iso.datetime(),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
      ipAddress: z.string().nullish(),
      userAgent: z.string().nullish(),
    }),
  })
  .nullable();
