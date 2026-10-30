import { redactSecrets, toJsonSafe } from "./json.js";

/** Error type with a stable machine-readable code for CLI/MCP JSON output. */
export class CliError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CliError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** Invalid command line usage (missing/unknown flags, bad values). */
export class UsageError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("USAGE", message, details);
    this.name = "UsageError";
  }
}

export interface ErrorPayload {
  ok: false;
  command?: string;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Convert any thrown value into a JSON-safe error payload. Never includes secrets. */
export function errorPayload(error: unknown, command?: string): ErrorPayload {
  const base = command === undefined ? {} : { command };
  if (error instanceof CliError) {
    return {
      ok: false,
      ...base,
      error: {
        code: error.code,
        message: redactSecrets(error.message),
        ...(error.details === undefined ? {} : { details: toJsonSafe(error.details) as Record<string, unknown> }),
      },
    };
  }
  if (error instanceof Error) {
    return { ok: false, ...base, error: { code: "UNEXPECTED", message: redactSecrets(error.message) } };
  }
  return { ok: false, ...base, error: { code: "UNEXPECTED", message: redactSecrets(String(error)) } };
}
