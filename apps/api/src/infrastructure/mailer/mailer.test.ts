import { EMAIL_TEMPLATES, type EmailTemplate } from "@menu-max/contracts";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, type Env } from "../../env";
import { classifyEmailError, createCloudflareMailer } from "./cloudflare";
import { createMailer, MailerError, type Mail } from "./mailer";
import { classifyResendStatus, createResendMailer } from "./resend";
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

function fakeFetch(respond: (init: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => respond(init ?? {}));
}

const accepted = () => Promise.resolve(Response.json({ id: "re-1" }));

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
  it("en development usa el adaptador de consola y no llama a Resend", async () => {
    const fetchSpy = fakeFetch(accepted);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await createMailer(bindings({ ENVIRONMENT: "development" })).send(mails["verify-email"]);

    expect(fetchSpy).not.toHaveBeenCalled();
    const output = String(consoleInfo.mock.calls[0]?.[0]);
    expect(output).toContain("Para: ana@example.com");
    expect(output).toContain("Asunto: Confirma tu correo en MenusMax");
    expect(output).toContain(`Enlace: ${url}`);
  });

  it.each(["staging", "production"] as const)("en %s envía con Resend", async (environment) => {
    const fetchSpy = fakeFetch(accepted);

    await createMailer(bindings({ ENVIRONMENT: environment })).send(mails["reset-password"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
  });
});

describe("createResendMailer", () => {
  const resendEnv = {
    RESEND_API_KEY: "resend-test-placeholder",
    EMAIL_FROM: "MenusMax <avisos@example.com>",
  };

  it("envía a la API de Resend con la API key, el remitente y la plantilla", async () => {
    const fetchSpy = fakeFetch(accepted);

    await createResendMailer(resendEnv).send(mails.invitation);

    const [endpoint, init] = fetchSpy.mock.calls[0] ?? [];
    expect(endpoint).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer resend-test-placeholder");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "MenusMax <avisos@example.com>",
      to: ["ana@example.com"],
      ...renderEmail(mails.invitation),
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [400, "permanent"],
    [422, "permanent"],
    [401, "transient"],
    [403, "transient"],
    [429, "transient"],
    [500, "transient"],
    [503, "transient"],
  ] as const)("clasifica HTTP %i como %s", async (status, kind) => {
    fakeFetch(() =>
      Promise.resolve(Response.json({ message: "error for ana@example.com" }, { status })),
    );

    const error: unknown = await createResendMailer(resendEnv)
      .send(mails["verify-email"])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailerError);
    expect(error).toMatchObject({ kind });
    expect((error as Error).message).not.toContain("ana@example.com");
    expect((error as Error).message).not.toContain(resendEnv.RESEND_API_KEY);
    expect(classifyResendStatus(status)).toBe(kind);
  });

  it("una falla de red es transitoria", async () => {
    fakeFetch(() => Promise.reject(new TypeError("network error")));

    const sending = createResendMailer(resendEnv).send(mails["verify-email"]);

    await expect(sending).rejects.toMatchObject({ name: "MailerError", kind: "transient" });
  });

  it("un envío que no responde a tiempo se cancela y es transitorio", async () => {
    fakeFetch(
      ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason as Error));
        }),
    );

    const sending = createResendMailer(resendEnv, 10).send(mails["verify-email"]);

    await expect(sending).rejects.toMatchObject({ name: "MailerError", kind: "transient" });
  });
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
