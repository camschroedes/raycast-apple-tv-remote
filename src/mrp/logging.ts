/**
 * Minimal logging shim. The bunatv reference uses a pino-style logger via
 * `createLogger(name)`; here we route through a lightweight debug logger
 * gated by the APPLETV_MCP_DEBUG env var, written to stderr so it never
 * corrupts the MCP stdio JSON-RPC stream on stdout.
 */
const DEBUG = process.env.APPLETV_MCP_DEBUG === "1" || process.env.APPLETV_MCP_DEBUG === "true";

// Accepts a fields object, a string message, or any error/value as the first
// arg (pino-style), matching how the bunatv source calls its logger.
type LogArg = Record<string, unknown> | string | unknown;

export interface Logger {
  trace(obj: LogArg, msg?: string): void;
  debug(obj: LogArg, msg?: string): void;
  info(obj: LogArg, msg?: string): void;
  warn(obj: LogArg, msg?: string): void;
  error(obj: LogArg, msg?: string): void;
}

function emit(name: string, level: string, obj: LogArg, msg?: string): void {
  if (!DEBUG) return;
  const text = typeof obj === "string" ? obj : (msg ?? "");
  let fields = "";
  if (typeof obj !== "string") {
    try {
      fields = ` ${JSON.stringify(obj, (_k, v) => (v instanceof Error ? v.message : v))}`;
    } catch {
      fields = ` ${String(obj)}`;
    }
  }
  const t = process.hrtime.bigint();
  process.stderr.write(`[${t}][${level}] ${name}: ${text}${fields}\n`);
}

export function createLogger(name: string): Logger {
  return {
    trace: (o, m) => emit(name, "trace", o, m),
    debug: (o, m) => emit(name, "debug", o, m),
    info: (o, m) => emit(name, "info", o, m),
    warn: (o, m) => emit(name, "warn", o, m),
    error: (o, m) => emit(name, "error", o, m),
  };
}
