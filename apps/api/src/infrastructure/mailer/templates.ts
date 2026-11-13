import type { Mail } from "./mailer";

// Plantillas puras en español de México: texto plano + HTML simple, sin imágenes remotas ni tracking.

export type RenderedEmail = { subject: string; text: string; html: string };

type Content = {
  subject: string;
  /** Párrafos antes del enlace. */
  intro: string[];
  action: string;
  url: string;
  /** Párrafos después del enlace. */
  outro: string[];
};

function contentFor(mail: Mail): Content {
  switch (mail.template) {
    case "verify-email":
      return {
        subject: "Confirma tu correo en MenusMax",
        intro: ["Confirma tu correo para que tu menú pueda recibir pedidos."],
        action: "Confirmar correo",
        url: mail.data.url,
        outro: [
          "El enlace vence en 24 horas.",
          "Si no creaste una cuenta en MenusMax, ignora este correo.",
        ],
      };
    case "reset-password":
      return {
        subject: "Restablece tu contraseña de MenusMax",
        intro: [
          "Recibimos una solicitud para restablecer tu contraseña. Abre el enlace para elegir una nueva.",
        ],
        action: "Restablecer contraseña",
        url: mail.data.url,
        outro: [
          "El enlace vence en 1 hora.",
          "Si no lo pediste, ignora este correo: tu contraseña no cambiará.",
        ],
      };
    case "invitation":
      return {
        subject: `${mail.data.inviterName} te invitó a ${mail.data.organizationName} en MenusMax`,
        intro: [
          `${mail.data.inviterName} te invitó a colaborar en ${mail.data.organizationName} en MenusMax.`,
        ],
        action: "Aceptar invitación",
        url: mail.data.url,
        outro: ["Si no esperabas esta invitación, ignora este correo."],
      };
    case "password-changed":
      return {
        subject: "Tu contraseña de MenusMax cambió",
        intro: ["La contraseña de tu cuenta cambió y cerramos tus otras sesiones."],
        action: "Restablecer contraseña",
        url: mail.data.url,
        outro: ["Si no fuiste tú, restablece tu contraseña ahora con el enlace."],
      };
  }
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function renderEmail(mail: Mail): RenderedEmail {
  const { subject, intro, action, url, outro } = contentFor(mail);

  const text = [...intro, `${action}: ${url}`, ...outro, "— MenusMax"].join("\n\n");

  const paragraph = (value: string) => `<p>${escapeHtml(value)}</p>`;
  const link = escapeHtml(url);
  const html = [
    "<!doctype html>",
    '<html lang="es-MX">',
    '<head><meta charset="utf-8"><title>' + escapeHtml(subject) + "</title></head>",
    '<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1f1f1f;max-width:560px;margin:0 auto;padding:24px">',
    ...intro.map(paragraph),
    `<p><a href="${link}" style="color:#1f1f1f;font-weight:600">${escapeHtml(action)}</a></p>`,
    `<p>Si el enlace no abre, copia esta dirección en tu navegador:<br>${link}</p>`,
    ...outro.map(paragraph),
    "<p>— MenusMax</p>",
    "</body>",
    "</html>",
  ].join("\n");

  return { subject, text, html };
}
