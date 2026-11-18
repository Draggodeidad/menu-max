import type { Mail } from "./mailer";

// Plantillas puras en español de México: texto plano + HTML simple, sin imágenes remotas ni tracking.

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
  /** Enlaces del correo, en orden. El adaptador de consola los imprime en development. */
  links: string[];
};

type Action = {
  /** Frase antes del enlace, en el mismo párrafo: "Si fuiste tú, entra…: [Entrar]". */
  lead?: string;
  label: string;
  url: string;
};

type Content = {
  subject: string;
  /** Párrafos antes de los enlaces. */
  intro: string[];
  actions: [Action, ...Action[]];
  /** Párrafos después de los enlaces. */
  outro: string[];
};

type TrialMail = Extract<Mail, { template: "trial-ending" | "trial-ended" }>;
type TrialData = TrialMail["data"];

const NOUNS = {
  branches: ["sucursal", "sucursales"],
  products: ["producto", "productos"],
  members: ["miembro del equipo", "miembros del equipo"],
} as const;

const KEPT = {
  branches: "Conservas tus sucursales actuales. Para agregar otra necesitas Pro.",
  products: "Conservas tus productos actuales. Para agregar otro necesitas Pro.",
  members: "Conservas a tus miembros actuales. Para agregar otro necesitas Pro.",
} as const;

const LIMIT_OF = {
  branches: "maxBranches",
  products: "maxProducts",
  members: "maxMembers",
} as const;

function counted(count: number, [singular, plural]: readonly [string, string]) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Fecha en Ciudad de México: "17 de febrero de 2027". */
function formatDate(iso: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeZone: "America/Mexico_City",
  }).format(new Date(iso));
}

/**
 * Qué permite y qué limita el plan al que pasa la cuenta, con los valores de `plans` que trae el
 * mensaje. Solo avisa "Conservas…" de lo que ya alcanzó o superó el límite: lo que excede sigue
 * operando y solo se bloquea agregar más (T20b).
 */
function planParagraphs({ planName, limits, features, usage }: TrialData) {
  const paragraphs = [
    `En ${planName} puedes tener hasta ${counted(limits.maxBranches, NOUNS.branches)}, ${counted(limits.maxProducts, NOUNS.products)} y ${counted(limits.maxMembers, NOUNS.members)}, contándote a ti.`,
  ];
  if (!features.customTheme) {
    paragraphs.push(
      "Tu menú conserva su diseño y su color principal; el fondo, la fuente y las imágenes personalizadas son parte de Pro.",
    );
  }
  if (!features.removeBranding) paragraphs.push("Tu menú mostrará el sello de MenusMax.");
  for (const resource of ["branches", "products", "members"] as const) {
    if (usage[resource] >= limits[LIMIT_OF[resource]]) paragraphs.push(KEPT[resource]);
  }
  return paragraphs;
}

function contentFor(mail: Mail): Content {
  switch (mail.template) {
    case "verify-email":
      return {
        subject: "Confirma tu correo en MenusMax",
        intro: ["Confirma tu correo para que tu menú pueda recibir pedidos."],
        actions: [{ label: "Confirmar correo", url: mail.data.url }],
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
        actions: [{ label: "Restablecer contraseña", url: mail.data.url }],
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
        actions: [{ label: "Aceptar invitación", url: mail.data.url }],
        outro: ["Si no esperabas esta invitación, ignora este correo."],
      };
    case "password-changed":
      return {
        subject: "Tu contraseña de MenusMax cambió",
        intro: ["La contraseña de tu cuenta cambió y cerramos tus otras sesiones."],
        actions: [{ label: "Restablecer contraseña", url: mail.data.url }],
        outro: ["Si no fuiste tú, restablece tu contraseña ahora con el enlace."],
      };
    case "trial-ending":
      return {
        subject: `Tu prueba gratis de MenusMax termina en ${counted(mail.data.daysLeft, ["día", "días"])}`,
        intro: [
          `Tu prueba gratis con todas las funciones termina el ${formatDate(mail.data.trialEndsAt)}. Después, tu cuenta pasa sola al plan ${mail.data.planName} y tu menú sigue funcionando: no tienes que hacer nada.`,
          ...planParagraphs(mail.data),
        ],
        actions: [{ label: "Revisar mi plan", url: mail.data.url }],
        outro: ["Nada se borra: tu menú, tus productos y tu equipo se quedan como están."],
      };
    case "trial-ended":
      return {
        subject: `Tu cuenta de MenusMax pasó al plan ${mail.data.planName}`,
        intro: [
          `Terminó tu prueba gratis y tu cuenta pasó al plan ${mail.data.planName}. Tu menú sigue funcionando y nada se borró.`,
          ...planParagraphs(mail.data),
        ],
        actions: [{ label: "Revisar mi plan", url: mail.data.url }],
        outro: [],
      };
    case "account-exists":
      // Sin datos del intento (negocio, IP, productos): el correo no debe servir para hacerle
      // llegar texto arbitrario a un tercero (T20c).
      return {
        subject: "Alguien intentó crear una cuenta con tu correo en MenusMax",
        intro: [
          "Alguien intentó crear un menú en MenusMax con este correo, que ya tiene una cuenta.",
        ],
        actions: [
          {
            lead: "Si fuiste tú, entra para publicar tu menú",
            label: "Entrar",
            url: mail.data.signInUrl,
          },
          {
            lead: "Si no recuerdas tu contraseña, restablécela",
            label: "Restablecer contraseña",
            url: mail.data.resetUrl,
          },
        ],
        outro: ["Si no fuiste tú, no tienes que hacer nada: tu cuenta sigue igual."],
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

/** Dirección en claro por si el enlace no abre; con varios, dice a cuál corresponde cada una. */
function fallback(actions: Content["actions"]) {
  if (actions.length === 1) {
    return `<p>Si el enlace no abre, copia esta dirección en tu navegador:<br>${escapeHtml(actions[0].url)}</p>`;
  }
  const lines = actions.map(({ label, url }) => `${escapeHtml(label)}: ${escapeHtml(url)}`);
  return `<p>Si un enlace no abre, copia su dirección en tu navegador:<br>${lines.join("<br>")}</p>`;
}

export function renderEmail(mail: Mail): RenderedEmail {
  const { subject, intro, actions, outro } = contentFor(mail);

  const text = [
    ...intro,
    ...actions.map(({ lead, label, url }) => `${lead ?? label}: ${url}`),
    ...outro,
    "— MenusMax",
  ].join("\n\n");

  const paragraph = (value: string) => `<p>${escapeHtml(value)}</p>`;
  const button = ({ lead, label, url }: Action) =>
    `<p>${lead === undefined ? "" : `${escapeHtml(lead)}: `}<a href="${escapeHtml(url)}" style="color:#1f1f1f;font-weight:600">${escapeHtml(label)}</a></p>`;
  const html = [
    "<!doctype html>",
    '<html lang="es-MX">',
    '<head><meta charset="utf-8"><title>' + escapeHtml(subject) + "</title></head>",
    '<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1f1f1f;max-width:560px;margin:0 auto;padding:24px">',
    ...intro.map(paragraph),
    ...actions.map(button),
    fallback(actions),
    ...outro.map(paragraph),
    "<p>— MenusMax</p>",
    "</body>",
    "</html>",
  ].join("\n");

  return { subject, text, html, links: actions.map(({ url }) => url) };
}
