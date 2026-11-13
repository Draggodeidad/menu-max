import type { JobMessage } from "@menu-max/contracts";
import { describe, expect, it, vi } from "vitest";
import { newId } from "../shared/ids";
import { enqueue } from "./jobs";

const email = "ana@example.com";

function fakeQueue() {
  const send = vi.fn((_body: JobMessage, _options?: QueueSendOptions) => Promise.resolve());
  return { JOBS: { send } as unknown as Queue<JobMessage>, send };
}

const validJob = (): JobMessage => ({
  type: "email.send",
  id: newId(),
  to: email,
  template: "verify-email",
  data: { url: "https://menusmax.example/verificar-correo?token=secreto" },
});

describe("enqueue", () => {
  it("envía a JOBS un mensaje válido como JSON", async () => {
    const { JOBS, send } = fakeQueue();
    const job = validJob();

    await enqueue({ JOBS }, job);

    expect(send).toHaveBeenCalledWith(job, { contentType: "json" });
  });

  it.each([
    ["tipo desconocido", { ...validJob(), type: "email.unknown" }],
    ["plantilla desconocida", { ...validJob(), template: "welcome" }],
    ["datos de otra plantilla", { ...validJob(), template: "invitation" }],
    ["correo inválido", { ...validJob(), to: "no-es-correo" }],
    ["id que no es uuid", { ...validJob(), id: "123" }],
    ["enlace que no es http", { ...validJob(), data: { url: "javascript:alert(1)" } }],
    ["llave desconocida", { ...validJob(), extra: true }],
  ])("rechaza un mensaje con %s y no lo envía", async (_case, message) => {
    const { JOBS, send } = fakeQueue();

    await expect(enqueue({ JOBS }, message as JobMessage)).rejects.toThrow(
      /Mensaje de cola inválido/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("no incluye valores del mensaje en el error", async () => {
    const { JOBS } = fakeQueue();
    const message = { ...validJob(), template: "welcome" } as unknown as JobMessage;

    const error = await enqueue({ JOBS }, message).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(email);
    expect((error as Error).message).not.toContain("secreto");
  });
});
