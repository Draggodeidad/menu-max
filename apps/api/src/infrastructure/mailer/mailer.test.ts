import { EMAIL_TEMPLATES, type EmailTemplate } from "@menu-max/contracts";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, type Env } from "../../env";
import { classifyEmailError, createCloudflareMailer } from "./cloudflare";
import { createMailer, MailerError, type Mail } from "./mailer";
import { renderEmail } from "./templates";

const url = "https://menusmax.example/verificar-correo?token=abc&x=1";

const mails = {
  "verify-email": { to: "ana@example.com", template: "verify-email", data: { url } },
  "reset-password": { to: "ana@example.com", template: "reset-password", data: { url } },
  invitation: {
    to: "ana@example.com",
    template: "invitation",
    data: { url, organizationName: "Tacos <El Güero>", inviterName: "Luis & Co" },
  },
  "password-changed": { to: "ana@example.com", template: "password-changed", data: { url } },
} satisfies { [Template in EmailTemplate]: Extract<Mail, { template: Template }> };

function fakeEmail(send: (message: EmailMessageBuilder) => Promise<EmailSendResult>) {
  const spy = vi.fn(send);
  return { binding: { send: spy } as unknown as SendEmail, spy };
}

function bindings(overrides: Partial<Env>): Env {
  return { ...getEnv(env), ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderEmail", () => {
  it.each(EMAIL_TEMPLATES)(
    "%s produce asunto, texto y HTML completos con el enlace",
    (template) => {
      const { subject, text, html } = renderEmail(mails[template]);

      for (const part of [subject, text, html]) {
        expect(part.length).toBeGreaterThan(0);
        expect(part).not.toMatch(/undefined|null|\[object/);
      }
      expect(text).toContain(url);
      expect(html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
      expect(html).not.toMatch(/<img|<script|https?:\/\/(?!menusmax\.example)/);
      expect(html).toContain('lang="es-MX"');
    },
  );

  it("escapa en el HTML los nombres de la invitación", () => {
    const { subject, html } = renderEmail(mails.invitation);

    expect(subject).toBe("Luis & Co te invitó a Tacos <El Güero> en MenusMax");
    expect(html).toContain("Tacos &lt;El Güero&gt;");
    expect(html).toContain("Luis &amp; Co");
    expect(html).not.toContain("<El Güero>");
  });
});

describe("createMailer", () => {
  it("en development usa el adaptador de consola y no llama a Email Service", async () => {
    const { binding, spy } = fakeEmail(() => Promise.resolve({ messageId: "m-1" }));
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await createMailer(bindings({ ENVIRONMENT: "development", EMAIL: binding })).send(
      mails["verify-email"],
    );

    expect(spy).not.toHaveBeenCalled();
    const output = String(consoleInfo.mock.calls[0]?.[0]);
    expect(output).toContain("Para: ana@example.com");
    expect(output).toContain("Asunto: Confirma tu correo en MenusMax");
    expect(output).toContain(`Enlace: ${url}`);
  });

  it.each(["staging", "production"] as const)(
    "en %s envía con Email Service",
    async (environment) => {
      const { binding, spy } = fakeEmail(() => Promise.resolve({ messageId: "m-1" }));

      await createMailer(bindings({ ENVIRONMENT: environment, EMAIL: binding })).send(
        mails["reset-password"],
      );

      const rendered = renderEmail(mails["reset-password"]);
      expect(spy).toHaveBeenCalledWith({
        from: { name: "MenusMax", email: "no-responder@example.com" },
        to: "ana@example.com",
        ...rendered,
      });
    },
  );
});

describe("createCloudflareMailer", () => {
  it("acepta EMAIL_FROM sin nombre", async () => {
    const { binding, spy } = fakeEmail(() => Promise.resolve({ messageId: "m-1" }));

    await createCloudflareMailer({ EMAIL: binding, EMAIL_FROM: "avisos@example.com" }).send(
      mails["verify-email"],
    );

    expect(spy.mock.calls[0]?.[0].from).toBe("avisos@example.com");
  });

  it.each([
    ["sender address not verified", "permanent"],
    ["Invalid recipient address", "permanent"],
    ["recipient is suppressed", "permanent"],
    ["internal error, try again", "transient"],
    ["rate limit exceeded", "transient"],
  ] as const)("clasifica «%s» como %s", async (message, kind) => {
    const { binding } = fakeEmail(() => Promise.reject(new Error(message)));

    const sending = createCloudflareMailer({
      EMAIL: binding,
      EMAIL_FROM: "avisos@example.com",
    }).send(mails["verify-email"]);

    await expect(sending).rejects.toBeInstanceOf(MailerError);
    await expect(sending).rejects.toMatchObject({ kind });
    expect(classifyEmailError(new Error(message))).toBe(kind);
  });

  it("un envío que no responde a tiempo es transitorio", async () => {
    const { binding } = fakeEmail(() => new Promise<never>(() => undefined));

    const sending = createCloudflareMailer(
      { EMAIL: binding, EMAIL_FROM: "avisos@example.com" },
      10,
    ).send(mails["verify-email"]);

    await expect(sending).rejects.toMatchObject({ name: "MailerError", kind: "transient" });
  });
});
