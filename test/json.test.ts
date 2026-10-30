import { describe, expect, it } from "vitest";

import { CliError, errorPayload } from "../src/errors.js";
import { jsonString, redactSecrets, toJsonSafe } from "../src/json.js";

describe("JSON safety", () => {
  it("converts bigints recursively and drops undefined fields", () => {
    expect(
      toJsonSafe({
        big: 123n,
        nested: { amount: 456n, missing: undefined },
        array: [1n, undefined, "x"],
        address: "0xabc",
      }),
    ).toEqual({
      big: "123",
      nested: { amount: "456" },
      array: ["1", null, "x"],
      address: "0xabc",
    });
  });

  it("redacts the configured RPC URL from strings", () => {
    const rpc = "https://rpc.example.invalid/secret-key";
    const oldRpc = process.env.AGENTSWAP_RPC_URL;
    process.env.AGENTSWAP_RPC_URL = rpc;
    try {
      expect(redactSecrets(`rpc ${rpc}`)).toBe("rpc [redacted-rpc-url]");
    } finally {
      if (oldRpc === undefined) delete process.env.AGENTSWAP_RPC_URL;
      else process.env.AGENTSWAP_RPC_URL = oldRpc;
    }
  });

  it("redacts the trimmed RPC URL and error details", () => {
    const rpc = "https://rpc.example.invalid/secret-key";
    const oldRpc = process.env.AGENTSWAP_RPC_URL;
    process.env.AGENTSWAP_RPC_URL = `  ${rpc}/  `;
    try {
      expect(redactSecrets(`request failed: ${rpc}`)).toBe("request failed: [redacted-rpc-url]");
      expect(redactSecrets(`request failed: ${rpc}/`)).toBe("request failed: [redacted-rpc-url]");
      const withLogin = "https://alice:secret@rpc.example.invalid/secret-key";
      process.env.AGENTSWAP_RPC_URL = `  ${withLogin}  `;
      expect(redactSecrets("request failed: https://rpc.example.invalid/secret-key")).toBe(
        "request failed: [redacted-rpc-url]",
      );
      const payload = errorPayload(
        new CliError("RPC_ERROR", `request failed: ${rpc}`, { endpoint: rpc }),
      );
      expect(JSON.stringify(payload)).not.toContain("secret-key");
    } finally {
      if (oldRpc === undefined) delete process.env.AGENTSWAP_RPC_URL;
      else process.env.AGENTSWAP_RPC_URL = oldRpc;
    }
  });

  it("prints exactly one parseable JSON object with a trailing newline", () => {
    const output = jsonString({ ok: true, value: 5n });
    expect(output.endsWith("\n")).toBe(true);
    expect(output.trimEnd().split("\n").filter((line) => line.trim() === "{}").length).toBe(0);
    const parsed = JSON.parse(output) as { ok: boolean; value: string };
    expect(parsed).toEqual({ ok: true, value: "5" });
    expect(() => JSON.parse(`${output}{}`)).toThrow();
  });
});
