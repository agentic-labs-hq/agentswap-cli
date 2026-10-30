/**
 * Remove the configured RPC endpoint from any string before it is printed.
 * Binance Agentic Wallet credentials are never read or stored by this CLI, so
 * there is no signer material to redact.
 */
export function redactSecrets(text: string): string {
  const raw = process.env.AGENTSWAP_RPC_URL;
  if (raw === undefined || raw.length === 0) return text;
  let redacted = text;
  const trimmed = raw.trim();
  const candidates = new Set([raw, trimmed]);
  try {
    const parsed = new URL(trimmed);
    const normalized = parsed.href;
    candidates.add(normalized);
    candidates.add(normalized.replace(/\/$/, ""));
    parsed.username = "";
    parsed.password = "";
    candidates.add(parsed.href);
    candidates.add(parsed.href.replace(/\/$/, ""));
  } catch {
    // resolveRpcUrl() reports the invalid URL; redact the raw forms above.
  }
  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    redacted = redacted.split(candidate).join("[redacted-rpc-url]");
  }
  return redacted;
}

/**
 * Recursively convert a command result into JSON-safe data: bigints become
 * decimal strings, `undefined` object fields are dropped, and known secrets are
 * redacted. This keeps CLI JSON and MCP structuredContent identical.
 */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : toJsonSafe(item)));
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      output[key] = toJsonSafe(item);
    }
    return output;
  }
  return value;
}

/** Serialize a single JSON object with a trailing newline. */
export function jsonString(value: unknown): string {
  return `${JSON.stringify(toJsonSafe(value), null, 2)}\n`;
}

export function writeJson(value: unknown): void {
  process.stdout.write(jsonString(value));
}
