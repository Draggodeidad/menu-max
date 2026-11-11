import type { Handle } from "@sveltejs/kit/hooks";
import { leerSesion } from "#lib/server/sesion.js";

export const handle: Handle = ({ event, resolve }) => {
  event.locals.session = leerSesion(event.cookies);
  return resolve(event);
};
