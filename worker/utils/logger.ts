/**
 * Structured JSON logging. Values under sensitive-looking keys are redacted so
 * credentials never reach Workers Logs.
 */
type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|credential|api[_-]?key|login/i;
const MAX_DEPTH = 4;

function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value === null || typeof value !== "object" || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(inner, depth + 1);
  }
  return result;
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const entry = JSON.stringify({ level, event, time: new Date().toISOString(), ...(redact(fields) as object) });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
