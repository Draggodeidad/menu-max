import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
