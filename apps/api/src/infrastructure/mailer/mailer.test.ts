import { EMAIL_TEMPLATES, type EmailTemplate } from "@menu-max/contracts";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, type Env } from "../../env";
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
  "trial-ending": {
    to: "ana@example.com",
    template: "trial-ending",
    data: {
      url,
      planName: "Gratis",
      limits: { maxBranches: 1, maxProducts: 50, maxMembers: 3 },
      features: { customTheme: false, removeBranding: false },
      usage: { branches: 3, products: 12, members: 3 },
      trialEndsAt: "2027-02-17T20:00:00.000Z",
      daysLeft: 15,
    },
  },
  "trial-ended": {
    to: "ana@example.com",
    template: "trial-ended",
    data: {
      url,
      planName: "Gratis",
      limits: { maxBranches: 1, maxProducts: 50, maxMembers: 3 },
      features: { customTheme: false, removeBranding: false },
      usage: { branches: 1, products: 80, members: 1 },
    },
  },
} satisfies { [Template in EmailTemplate]: Extract<Mail, { template: Template }> };

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

describe("correos de fin de prueba", () => {
  it("trial-ending dice cuántos días faltan, la fecha y los límites del plan que trae", () => {
    const { subject, text } = renderEmail(mails["trial-ending"]);

    expect(subject).toBe("Tu prueba gratis de MenusMax termina en 15 días");
    expect(text).toContain("termina el 17 de febrero de 2027");
    expect(text).toContain("plan Gratis");
    expect(text).toContain("hasta 1 sucursal, 50 productos y 3 miembros del equipo");
    expect(text).toContain("el sello de MenusMax");
  });

  it("solo avisa que conserva lo que ya alcanzó o superó el límite", () => {
    const ending = renderEmail(mails["trial-ending"]).text;
    expect(ending).toContain("Conservas tus sucursales actuales. Para agregar otra necesitas Pro.");
    expect(ending).toContain("Conservas a tus miembros actuales.");
    expect(ending).not.toContain("Conservas tus productos actuales.");

    // 1 sucursal de 1: ya no puede agregar otra, así que también se avisa.
    const ended = renderEmail(mails["trial-ended"]).text;
    expect(ended).toContain("Conservas tus productos actuales. Para agregar otro necesitas Pro.");
    expect(ended).toContain("Conservas tus sucursales actuales.");
    expect(ended).not.toContain("Conservas a tus miembros actuales.");
  });

  it("los límites y capacidades salen de los datos, no de la plantilla", () => {
    const { subject, text } = renderEmail({
      ...mails["trial-ended"],
      data: {
        ...mails["trial-ended"].data,
        planName: "Básico",
        limits: { maxBranches: 2, maxProducts: 120, maxMembers: 1 },
        features: { customTheme: true, removeBranding: true },
      },
    });

    expect(subject).toBe("Tu cuenta de MenusMax pasó al plan Básico");
    expect(text).toContain("hasta 2 sucursales, 120 productos y 1 miembro del equipo");
    expect(text).not.toContain("sello de MenusMax");
    expect(text).not.toContain("son parte de Pro");
  });

  it("en singular cuando falta un día", () => {
    const { subject } = renderEmail({
      ...mails["trial-ending"],
      data: { ...mails["trial-ending"].data, daysLeft: 1 },
    });
    expect(subject).toBe("Tu prueba gratis de MenusMax termina en 1 día");
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
