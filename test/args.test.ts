import { describe, expect, it } from "vitest";

import {
  flagBool,
  flagString,
  flagStrings,
  parseCliArgs,
  parseFlags,
  resolveCommand,
} from "../src/args.js";
import { UsageError } from "../src/errors.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

describe("command resolution", () => {
  it("resolves the BAW preview command surface", () => {
    expect(resolveCommand(["doctor"]).command).toBe("doctor");
    expect(resolveCommand(["skill"]).command).toBe("skill");
    expect(resolveCommand(["status"]).command).toBe("status");
    expect(resolveCommand(["token", "create"]).command).toBe("token create");
    expect(resolveCommand(["token", "approve"]).command).toBe("token approve");
    expect(resolveCommand(["dex", "pool", "create"]).command).toBe("dex pool create");
    expect(resolveCommand(["dex", "lp", "add"]).command).toBe("dex lp add");
    expect(resolveCommand(["dex", "lp", "remove"]).command).toBe("dex lp remove");
    expect(resolveCommand(["dex", "quote"]).command).toBe("dex quote");
    expect(resolveCommand(["dex", "swap"]).command).toBe("dex swap");
    expect(resolveCommand(["dex", "positions"]).command).toBe("dex positions");
    expect(resolveCommand(["tx", "execute"]).command).toBe("tx execute");
    expect(resolveCommand(["tx", "status"]).command).toBe("tx status");
    expect(resolveCommand([]).command).toBe("help");
    expect(resolveCommand(["--help"]).command).toBe("help");
    expect(resolveCommand(["version"]).command).toBe("version");
  });

  it("rejects unknown or incomplete commands", () => {
    expect(() => resolveCommand(["nope"])).toThrowError(UsageError);
    expect(() => resolveCommand(["token", "burn"])).toThrowError(UsageError);
    expect(() => resolveCommand(["dex"])).toThrowError(UsageError);
    expect(() => resolveCommand(["dex", "pool"])).toThrowError(UsageError);
    expect(() => resolveCommand(["tx"])).toThrowError(UsageError);
  });
});

describe("flag parsing", () => {
  it("parses doctor --json", () => {
    const parsed = parseCliArgs(["doctor", "--json"]);
    expect(parsed.flags.json).toBe(true);
    expect(flagBool(parsed.flags, "json")).toBe(true);
  });

  it("parses token create with repeated recipients and mixed flag forms", () => {
    const parsed = parseCliArgs([
      "token",
      "create",
      "--name",
      "Example",
      "--symbol=EGT",
      "--supply",
      "1000",
      "--recipient",
      A,
      "--recipient",
      B,
      "--metadata-uri",
      "ipfs://example",
    ]);
    expect(parsed.command).toBe("token create");
    expect(flagString(parsed.flags, "name")).toBe("Example");
    expect(flagString(parsed.flags, "symbol")).toBe("EGT");
    expect(flagStrings(parsed.flags, "recipient")).toEqual([A, B]);
  });

  it("parses token approve and tx execute --confirm", () => {
    const approve = parseCliArgs(["token", "approve", "--token", A, "--spender", B, "--amount", "0"]);
    expect(flagString(approve.flags, "amount")).toBe("0");
    const execute = parseCliArgs(["tx", "execute", "--request-id", "req-1", "--confirm"]);
    expect(flagString(execute.flags, "request-id")).toBe("req-1");
    expect(flagBool(execute.flags, "confirm")).toBe(true);
  });

  it("parses tx status selectors", () => {
    const status = parseCliArgs(["tx", "status", "--order-id", "order-1"]);
    expect(flagString(status.flags, "order-id")).toBe("order-1");
    const byHash = parseCliArgs(["tx", "status", "--tx-hash", `0x${"ab".repeat(32)}`]);
    expect(flagString(byHash.flags, "tx-hash")).toBe(`0x${"ab".repeat(32)}`);
  });

  it("accepts negative tick values", () => {
    const parsed = parseCliArgs([
      "dex",
      "lp",
      "add",
      "--token",
      A,
      "--quote",
      B,
      "--fee",
      "3000",
      "--tick-lower",
      "-887220",
      "--tick-upper",
      "887220",
      "--amount0",
      "1",
      "--amount1",
      "1",
    ]);
    expect(flagString(parsed.flags, "tick-lower")).toBe("-887220");
  });

  it("rejects unknown, duplicate, missing, and positional arguments", () => {
    expect(() => parseFlags(["--nope"], {}, "test")).toThrowError(UsageError);
    expect(() => parseFlags(["--json", "--json"], {}, "test")).toThrowError(UsageError);
    expect(() => parseFlags(["--json=true"], {}, "test")).toThrowError(UsageError);
    expect(() => parseFlags(["--fee"], { fee: "value" }, "test")).toThrowError(UsageError);
    expect(() => parseFlags(["stray"], {}, "test")).toThrowError(UsageError);
  });

  it("removes broadcast/dry-run/max-spend flags entirely", () => {
    expect(() => parseCliArgs(["token", "create", "--broadcast"])).toThrowError(UsageError);
    expect(() => parseCliArgs(["token", "create", "--dry-run"])).toThrowError(UsageError);
    expect(() => parseCliArgs(["dex", "swap", "--max-spend", "0.01"])).toThrowError(UsageError);
  });

  it("supports --help on a subcommand", () => {
    const parsed = parseCliArgs(["dex", "quote", "--help"]);
    expect(parsed.flags.help).toBe(true);
  });
});
