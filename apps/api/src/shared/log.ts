const EMAIL = /([\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+)@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)/gu;
const PHONE_OR_UUID =
  /\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b|(?<![\p{L}\p{N}])((?:\+|\()?\d(?:[ .()-]{0,3}\d){7,14})(?![\p{L}\p{N}])/giu;
const SENSITIVE_KEY =
  /password|token|cookie|authorization|address|^(?:body|requestbody|headers|xmminternal|ip|clientip|xclientip|useragent)$/;
const REDACTED = "[REDACTADO]";

function redactValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return value
      .replace(EMAIL, (_match, local: string, domain: string) => `${local[0]}***@${domain}`)
      .replace(PHONE_OR_UUID, (match, phone?: string) =>
        phone ? `***${phone.replace(/\D/g, "").slice(-4)}` : match,
      );
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.has(value)) return "[CIRCULAR]";

  ancestors.add(value);
  const redacted: unknown = Array.isArray(value)
    ? value.map((item: unknown) => redactValue(item, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]: [string, unknown]) => {
          const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
          return [key, SENSITIVE_KEY.test(normalizedKey) ? REDACTED : redactValue(item, ancestors)];
        }),
      );
  ancestors.delete(value);
  return redacted;
}

export function redact(data: unknown): unknown {
  return redactValue(data, new WeakSet());
}

type LogLevel = "info" | "warn" | "error";
type LogData = Record<string, unknown> & { requestId: string; orgId?: string };

function write(level: LogLevel, event: string, data: LogData): void {
  console[level](JSON.stringify(redact({ ...data, level, event })));
}

export const log = {
  info: (event: string, data: LogData) => write("info", event, data),
  warn: (event: string, data: LogData) => write("warn", event, data),
  error: (event: string, data: LogData) => write("error", event, data),
};
