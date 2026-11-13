import type { JobMessage } from "@menu-max/contracts";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, type Env } from "../env";
import worker from "../index";
import { enqueue } from "../infrastructure/jobs";
import { newId } from "../shared/ids";
import { RETRY_DELAYS_SECONDS, retryDelaySeconds } from "./consumer";

const email = "ana@example.com";
const link = "https://menusmax.example/verificar-correo?token=secreto-de-prueba";

const job = (): JobMessage => ({
  type: "email.send",
  id: newId(),
  to: email,
  template: "verify-email",
  data: { url: link },
});

// Simula la respuesta de Resend; ninguna prueba sale a la red.
function fakeResend(respond: () => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(respond);
}

const accepted = () => Promise.resolve(Response.json({ id: "re-1" }));
const rejected =
  (status: number, message = "error") =>
  () =>
    Promise.resolve(Response.json({ message }, { status }));

function fakeDlq() {
  const send = vi.fn((_body: unknown) => Promise.resolve());
  return { JOBS_DLQ: { send, sendBatch: vi.fn() } as unknown as Queue<unknown>, send };
}

function bindings(overrides: Partial<Env>): Env {
  return { ...getEnv(env), ...overrides };
}

async function runQueue(body: unknown, overrides: Partial<Env>, attempts = 1) {
  const batch = createMessageBatch("menusmax-jobs-dev", [
    { id: "msg-1", timestamp: new Date(), attempts, body },
  ]);
  const [message] = batch.messages;
  if (!message) throw new Error("El lote de prueba debe tener un mensaje.");
  // getQueueResult no conserva `delaySeconds`: se lee de la llamada a `retry`.
  const retry = vi.spyOn(message, "retry");
  await worker.queue(batch, bindings(overrides));
  const result = await getQueueResult(batch, createExecutionContext());
  return { ...result, retryDelays: retry.mock.calls.map(([options]) => options?.delaySeconds) };
}

function captureLogs() {
  const lines: string[] = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  }
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consumidor de jobs", () => {
  it.each([
    ["no es objeto", "hola"],
    ["tipo desconocido", { ...job(), type: "sms.send" }],
    ["sin destinatario", { ...job(), to: undefined }],
  ])("manda a JOBS_DLQ un mensaje inválido (%s) sin reintentar", async (_case, body) => {
    const { JOBS_DLQ, send } = fakeDlq();
    const spy = fakeResend(accepted);
    const logs = captureLogs();

    const result = await runQueue(body, { ENVIRONMENT: "production", JOBS_DLQ });

    expect(send).toHaveBeenCalledWith(body);
    expect(spy).not.toHaveBeenCalled();
    expect(result.explicitAcks).toEqual(["msg-1"]);
    expect(result.retryMessages).toEqual([]);
    expect(logs.some((line) => line.includes('"event":"job.invalid"'))).toBe(true);
  });

  it("reintenta un mensaje inválido si la DLQ no lo aceptó", async () => {
    const { JOBS_DLQ, send } = fakeDlq();
    send.mockRejectedValueOnce(new Error("queue unavailable"));
    captureLogs();

    const result = await runQueue("hola", { JOBS_DLQ });

    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([{ msgId: "msg-1" }]);
    expect(result.retryDelays).toEqual([30]);
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "un error transitorio del mailer reintenta con backoff (intento %i)",
    async (attempts) => {
      fakeResend(rejected(500));
      captureLogs();

      const result = await runQueue(job(), { ENVIRONMENT: "production" }, attempts);

      expect(result.explicitAcks).toEqual([]);
      expect(result.retryMessages).toEqual([{ msgId: "msg-1" }]);
      expect(result.retryDelays).toEqual([retryDelaySeconds(attempts)]);
    },
  );

  it("usa los retrasos 30, 60, 120, 240 y 480 s", () => {
    expect(RETRY_DELAYS_SECONDS).toEqual([30, 60, 120, 240, 480]);
    expect([1, 2, 3, 4, 5, 6].map(retryDelaySeconds)).toEqual([30, 60, 120, 240, 480, 480]);
  });

  it("un error permanente del mailer se confirma sin reintento ni DLQ", async () => {
    fakeResend(rejected(422));
    const { JOBS_DLQ, send } = fakeDlq();
    const logs = captureLogs();

    const result = await runQueue(job(), { ENVIRONMENT: "production", JOBS_DLQ });

    expect(result.explicitAcks).toEqual(["msg-1"]);
    expect(result.retryMessages).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes('"event":"job.failed_permanently"'))).toBe(true);
  });

  it("los logs no incluyen el destinatario ni el enlace", async () => {
    fakeResend(rejected(500, `internal error for ${email}`));
    const logs = captureLogs();

    await runQueue(job(), { ENVIRONMENT: "production" });

    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(email);
      expect(line).not.toContain("secreto-de-prueba");
    }
  });

  it("en development, encolar un email.send imprime el correo en la terminal", async () => {
    const sent: unknown[] = [];
    const JOBS = {
      send: (body: unknown) => {
        sent.push(body);
        return Promise.resolve();
      },
      sendBatch: () => Promise.resolve(),
    } as unknown as Queue<JobMessage>;
    const spy = fakeResend(accepted);
    const logs = captureLogs();

    await enqueue({ JOBS }, job());
    expect(sent).toHaveLength(1);
    const result = await runQueue(sent[0], { ENVIRONMENT: "development" });

    expect(spy).not.toHaveBeenCalled();
    expect(result.explicitAcks).toEqual(["msg-1"]);
    const printed = logs.find((line) => line.startsWith("── Correo"));
    expect(printed).toContain(`Para: ${email}`);
    expect(printed).toContain("Asunto: Confirma tu correo en MenusMax");
    expect(printed).toContain(`Enlace: ${link}`);
  });
});
