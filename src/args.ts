import { UsageError } from "./errors.js";

export type FlagKind = "boolean" | "value" | "repeatable";
export type FlagSpec = Record<string, FlagKind>;
export type FlagValue = string | boolean | string[];

const BASE_FLAGS: FlagSpec = { json: "boolean", help: "boolean" };

export interface CommandSpec {
  /** Short one-line description used by help output. */
  summary: string;
  flags: FlagSpec;
}

/** Complete preview/read command surface. There is no broadcast/dry-run mode. */
export const COMMANDS: Record<string, CommandSpec> = {
  doctor: {
    summary: "read-only RPC + Binance Agentic Wallet health check",
    flags: {},
  },
  skill: {
    summary: "print the packaged SKILL.md operational guide",
    flags: {},
  },
  status: {
    summary: "read-only chain/address-book/wallet status",
    flags: {},
  },
  "token create": {
    summary: "build and preview a fixed-supply gated token creation",
    flags: {
      name: "value",
      symbol: "value",
      supply: "value",
      recipient: "repeatable",
      "metadata-uri": "value",
      policy: "value",
    },
  },
  "token approve": {
    summary: "build and preview an exact ERC-20 approval or revoke",
    flags: {
      token: "value",
      spender: "value",
      amount: "value",
    },
  },
  "dex pool create": {
    summary: "build and preview a gated pool creation",
    flags: {
      token: "value",
      quote: "value",
      fee: "value",
      price: "value",
      "sqrt-price-x96": "value",
    },
  },
  "dex lp add": {
    summary: "build and preview a gated LP mint (or its approval steps)",
    flags: {
      token: "value",
      quote: "value",
      fee: "value",
      "tick-lower": "value",
      "tick-upper": "value",
      amount0: "value",
      amount1: "value",
      "min-amount0": "value",
      "min-amount1": "value",
      recipient: "value",
    },
  },
  "dex lp remove": {
    summary: "build and preview an LP decrease/collect/burn sequence",
    flags: {
      "token-id": "value",
      liquidity: "value",
      "min-amount0": "value",
      "min-amount1": "value",
      "no-collect": "boolean",
      "no-burn": "boolean",
      "collect-only": "boolean",
    },
  },
  "dex quote": {
    summary: "quote an exact-input or exact-output swap (read-only)",
    flags: {
      "token-in": "value",
      "token-out": "value",
      fee: "value",
      "amount-in": "value",
      "exact-out": "boolean",
    },
  },
  "dex swap": {
    summary: "build and preview an exact-input swap (or its approval step)",
    flags: {
      "token-in": "value",
      "token-out": "value",
      fee: "value",
      "amount-in": "value",
      "min-out": "value",
      recipient: "value",
      deadline: "value",
      "native-out": "boolean",
    },
  },
  "dex positions": {
    summary: "list NPM positions for an owner (read-only)",
    flags: {
      owner: "value",
    },
  },
  "tx execute": {
    summary: "execute one previewed BAW request (requires --confirm)",
    flags: {
      "request-id": "value",
      confirm: "boolean",
    },
  },
  "tx status": {
    summary: "query a transaction by tx hash or a locally journaled order id",
    flags: {
      "order-id": "value",
      "tx-hash": "value",
    },
  },
};

export interface ParsedCommand {
  command: string;
  flags: Record<string, FlagValue>;
}

function commandError(message: string): never {
  throw new UsageError(message);
}

/** Resolve the command path, rejecting unknown or incomplete command tokens. */
export function resolveCommand(argv: readonly string[]): { command: string; rest: string[] } {
  if (argv.length === 0) return { command: "help", rest: [] };
  const first = argv[0]!;
  if (first === "--help" || first === "-h" || first === "help") return { command: "help", rest: argv.slice(1) };
  if (first === "--version" || first === "version") return { command: "version", rest: argv.slice(1) };

  let key: string;
  let length: number;
  if (first === "doctor" || first === "status" || first === "skill") {
    key = first;
    length = 1;
  } else if (first === "token") {
    const sub = argv[1];
    if (sub !== "create" && sub !== "approve") {
      commandError('Unknown token command. Expected "agentswap token create" or "agentswap token approve".');
    }
    key = `token ${sub}`;
    length = 2;
  } else if (first === "dex") {
    const sub = argv[1];
    if (sub === "pool") {
      if (argv[2] !== "create") commandError('Unknown dex pool command. Expected "agentswap dex pool create".');
      key = "dex pool create";
      length = 3;
    } else if (sub === "lp") {
      if (argv[2] !== "add" && argv[2] !== "remove") {
        commandError('Unknown dex lp command. Expected "agentswap dex lp add" or "agentswap dex lp remove".');
      }
      key = `dex lp ${argv[2]}`;
      length = 3;
    } else if (sub === "quote" || sub === "swap" || sub === "positions") {
      key = `dex ${sub}`;
      length = 2;
    } else {
      commandError("Unknown dex command. Expected pool create, lp add, quote, swap, or positions.");
    }
  } else if (first === "tx") {
    const sub = argv[1];
    if (sub !== "execute" && sub !== "status") {
      commandError('Unknown tx command. Expected "agentswap tx execute" or "agentswap tx status".');
    }
    key = `tx ${sub}`;
    length = 2;
  } else {
    commandError(`Unknown command "${first}". Run "agentswap --help" for usage.`);
  }

  if (!(key in COMMANDS)) commandError(`Command "${key}" is not implemented.`);
  return { command: key, rest: argv.slice(length) };
}

/** Parse `--flag value`, `--flag=value`, boolean flags, and repeatable flags. */
export function parseFlags(
  args: readonly string[],
  spec: FlagSpec,
  command = "command",
  baseFlags: FlagSpec = BASE_FLAGS,
): Record<string, FlagValue> {
  const allSpec: FlagSpec = { ...baseFlags, ...spec };
  const flags: Record<string, FlagValue> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      commandError(`Unexpected argument "${arg}" for ${command}. Options must start with "--".`);
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    if (name === "" || name.startsWith("-")) commandError(`Invalid option "${arg}".`);
    const inlineValue = equals === -1 ? undefined : arg.slice(equals + 1);
    const kind = allSpec[name];
    if (kind === undefined) commandError(`Unknown option "--${name}" for ${command}.`);

    if (kind === "boolean") {
      if (inlineValue !== undefined) commandError(`Option "--${name}" does not take a value.`);
      if (flags[name] !== undefined) commandError(`Option "--${name}" was provided more than once.`);
      flags[name] = true;
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        commandError(`Option "--${name}" needs a value.`);
      }
      value = next;
      index += 1;
    }
    if (value === "") commandError(`Option "--${name}" needs a non-empty value.`);

    if (kind === "repeatable") {
      const existing = flags[name];
      if (existing === undefined) flags[name] = [value];
      else if (Array.isArray(existing)) existing.push(value);
      else commandError(`Option "--${name}" cannot mix single and repeated values.`);
    } else {
      if (flags[name] !== undefined) commandError(`Option "--${name}" was provided more than once.`);
      flags[name] = value;
    }
  }
  return flags;
}

export function parseCliArgs(argv: readonly string[]): ParsedCommand {
  const { command, rest } = resolveCommand(argv);
  if (command === "help" || command === "version") return { command, flags: {} };
  const spec = COMMANDS[command];
  if (spec === undefined) commandError(`Unknown command "${command}".`);
  return { command, flags: parseFlags(rest, spec.flags, `"agentswap ${command}"`) };
}

export function flagString(flags: Record<string, FlagValue>, name: string, required = false): string | undefined {
  const value = flags[name];
  if (value === undefined) {
    if (required) throw new UsageError(`Missing required option --${name}.`);
    return undefined;
  }
  if (typeof value !== "string") throw new UsageError(`Option --${name} must be a single value.`);
  return value;
}

export function flagBool(flags: Record<string, FlagValue>, name: string): boolean {
  const value = flags[name];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new UsageError(`Option --${name} is a boolean flag.`);
  return value;
}

export function flagStrings(flags: Record<string, FlagValue>, name: string, required = false): string[] {
  const value = flags[name];
  if (value === undefined) {
    if (required) throw new UsageError(`Missing required option --${name}.`);
    return [];
  }
  if (!Array.isArray(value)) throw new UsageError(`Option --${name} must be provided one or more times.`);
  return value;
}
