import { fail, redirect } from "@sveltejs/kit";
import { parseMoneyToCents } from "#lib/money.js";
import {
  COOKIE_PUBLICADO,
  LIMITE_COOKIE_PUBLICADO,
  MAX_PRODUCTOS_PUBLICADO,
  MODALIDADES,
  PRODUCTOS_EJEMPLO_CREAR,
  slugNegocioDemo,
  slugify,
  tema,
  type NegocioPublicado,
} from "#lib/server/demo.js";
import { abrirSesion } from "#lib/server/sesion.js";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
  productosEjemplo: PRODUCTOS_EJEMPLO_CREAR, // TEMPORAL: sin API todavía
  tema,
});

export const actions: Actions = {
  // TEMPORAL: sin API todavía. No hay cuenta ni base de datos: el menú publicado se guarda
  // en una cookie del navegador y la cuenta (correo y contraseña) solo se valida.
  publicar: async ({ request, cookies }) => {
    const form = await request.formData();
    const texto = (name: string) => String(form.get(name) ?? "").trim();
    const nombres = form.getAll("productoNombre").map((v) => String(v).trim());
    const precios = form.getAll("productoPrecio").map((v) => String(v).trim());
    const modalidades = MODALIDADES.filter((m) => form.getAll("modalidad").includes(m));

    const values = {
      nombre: texto("nombre"),
      whatsapp: texto("whatsapp"),
      correo: texto("correo"),
      modalidades,
      productos: nombres.map((nombre, i) => ({ nombre, precio: precios[i] ?? "" })),
    };

    const fieldErrors: Record<string, string> = {};
    const slug = slugify(values.nombre);
    if (values.nombre.length < 2 || !slug) {
      fieldErrors.nombre = "Escribe el nombre de tu negocio (al menos 2 letras).";
    } else if (values.nombre.length > 60) {
      fieldErrors.nombre = "Acorta el nombre a 60 caracteres.";
    } else if (slug === slugNegocioDemo) {
      fieldErrors.nombre = "Ese nombre ya lo usa el negocio de ejemplo. Elige otro.";
    }

    const productos: NegocioPublicado["productos"] = [];
    values.productos.forEach((p, i) => {
      if (!p.nombre && !p.precio) return;
      const precioCents = parseMoneyToCents(p.precio);
      if (!p.nombre) fieldErrors[`producto-${i}`] = "Escribe el nombre del producto.";
      else if (p.nombre.length > 60) fieldErrors[`producto-${i}`] = "Acorta el nombre a 60 letras.";
      else if (precioCents === null)
        fieldErrors[`precio-${i}`] = "Escribe un precio mayor a $0 en pesos, por ejemplo 22.00.";
      else productos.push({ id: `p${productos.length + 1}`, nombre: p.nombre, precioCents });
    });
    if (
      productos.length === 0 &&
      !Object.keys(fieldErrors).some((k) => /^(producto|precio)-/.test(k))
    ) {
      fieldErrors.productos = "Agrega al menos un producto con nombre y precio.";
    }
    if (values.productos.length > MAX_PRODUCTOS_PUBLICADO) {
      fieldErrors.productos = `La demo admite hasta ${MAX_PRODUCTOS_PUBLICADO} productos.`;
    }
    if (modalidades.length === 0) {
      fieldErrors.modalidades = "Elige al menos una forma de entregar tus pedidos.";
    }
    if (values.whatsapp.replace(/\D/g, "").length !== 10) {
      fieldErrors.whatsapp = "Escribe tu WhatsApp de 10 dígitos.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.correo)) {
      fieldErrors.correo = "Escribe un correo válido, por ejemplo tu@negocio.com.";
    }
    if (String(form.get("contrasena") ?? "").length < 8) {
      fieldErrors.contrasena = "Usa una contraseña de al menos 8 caracteres.";
    }
    if (Object.keys(fieldErrors).length > 0) return fail(400, { fieldErrors, values });

    const negocio: NegocioPublicado = {
      slug,
      nombre: values.nombre,
      whatsapp: values.whatsapp.replace(/\D/g, ""),
      modalidades,
      productos,
    };
    const valor = JSON.stringify(negocio);
    if (encodeURIComponent(valor).length > LIMITE_COOKIE_PUBLICADO) {
      return fail(400, {
        fieldErrors: {
          productos: "Tu menú es demasiado largo para la demo. Quita algunos productos.",
        },
        values,
      });
    }
    cookies.set(COOKIE_PUBLICADO, valor, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });
    abrirSesion(cookies);
    redirect(303, "/app/listo");
  },
};
