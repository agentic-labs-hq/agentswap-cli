import { execFile } from "node:child_process";

import type { Address, Hex } from "viem";

import { CliError } from "./errors.js";
import { redactSecrets } from "./json.js";

/** Version required by the official `binance-agentic-wallet` skill (1.13.0). */
export const REQUIRED_BAW_VERSION = "1.11.0";
export const BSC_BINANCE_CHAIN_ID = "56";

export interface BawErrorInfo {
  code?: number | string;
  name?: string;
  message?: string;
  data?: unknown;
}

export interface BawEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: BawErrorInfo;
}

export interface BawRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Injectable runner so tests can mock `baw` without network access. */
export type BawRunner = (args: readonly string[], timeoutMs: number) => Promise<BawRunnerResult>;

function executeBaw(args: readonly string[], timeoutMs: number): Promise<BawRunnerResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "baw",
      [...args],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: process.env },
      (error, stdout, stderr) => {
        const out = typeof stdout === "string" ? stdout : String(stdout ?? "");
        const err = typeof stderr === "string" ? stderr : String(stderr ?? "");
        if (error === null) {
          resolve({ stdout: out, stderr: err, exitCode: 0 });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(
            new CliError(
              "BAW_NOT_INSTALLED",
              "The `baw` CLI is not installed or not on PATH. Install @binance/agentic-wallet@1.11.0 and retry.",
            ),
          );
          return;
        }
        if ((error as { killed?: boolean }).killed === true) {
          reject(new CliError("BAW_TIMEOUT", `The \`baw\` command timed out after ${timeoutMs}ms.`));
          return;
        }
        // `baw` normally exits 0 even for structured errors; if it exits non-zero
        // but produced JSON, let the caller surface that structured error.
        if (out.trim().length > 0) {
          resolve({ stdout: out, stderr: err, exitCode: typeof code === "number" ? code : 1 });
          return;
        }
        reject(
          new CliError(
            "BAW_UNAVAILABLE",
            `Could not run the Binance Agentic Wallet CLI (baw): ${redactSecrets(error.message)}`,
          ),
        );
      },
    );
  });
}

function mapBawErrorCode(error: BawErrorInfo): string {
  const name = error.name ?? "";
  if (name === "NETWORK_ERROR" || /network|TLS|socket/i.test(error.message ?? "")) return "BAW_UNAVAILABLE";
  if (name.includes("DEV_MODE")) return "BAW_DEV_MODE";
  return "BAW_ERROR";
}

/** A structured `baw` error, preserving the original name/code/message. */
export class BawCommandError extends CliError {
  readonly bawError: BawErrorInfo;

  constructor(error: BawErrorInfo) {
    super(mapBawErrorCode(error), error.message ?? "The Binance Agentic Wallet command failed.", {
      bawError: error,
    });
    this.name = "BawCommandError";
    this.bawError = error;
  }
}

export interface BawWalletStatus {
  status: string;
}

export interface BawAddressEntry {
  binanceChainId: string | number;
  chainName?: string;
  address: string;
}

export interface BawAddressBook {
  addresses: BawAddressEntry[];
}

export interface BawDevMode {
  enabled?: boolean;
  expiresAt?: number | null;
  dailyLimit?: number;
  balanceExceeded?: boolean;
}

export interface BawWalletSettings {
  devMode?: BawDevMode;
  sessionExpireTime?: string;
  inactiveSignOutTime?: string;
  [key: string]: unknown;
}

export interface BawContractCallPreview {
  requestId?: string;
  parsedTx?: Record<string, unknown>;
  simulationResult?: Record<string, unknown>;
  risks?: Record<string, unknown>;
  tokenInfos?: Record<string, unknown>;
  requireConfirmation?: boolean;
  expiresAt?: number;
  [key: string]: unknown;
}

export interface BawContractCallExecute {
  orderId?: string;
  status?: string;
  txHash?: string | null;
  message?: string | null;
  [key: string]: unknown;
}

export interface BawTxStatus {
  binanceChainId?: string;
  txHash?: string;
  status?: string;
  txTime?: string | null;
}

export interface PreviewCallParams {
  from: Address;
  to: Address;
  value: bigint;
  inputData: Hex;
}

/**
 * Thin typed wrapper around the `baw` CLI. Every invocation appends `--json`
 * (except `--version`) and treats `success:false` as a structured error.
 * No private keys or signer state are handled here.
 */
export class BawClient {
  constructor(readonly runner: BawRunner = executeBaw) {}

  /** Run a command and return its JSON envelope without interpreting `success`. */
  async envelope<T>(args: readonly string[], timeoutMs = 30_000): Promise<BawEnvelope<T>> {
    const result = await this.runner([...args, "--json"], timeoutMs);
    const text = result.stdout.trim();
    if (text === "") {
      throw new CliError("BAW_INVALID_OUTPUT", "The `baw` command returned no JSON output.", {
        exitCode: result.exitCode,
        stderr: redactSecrets(result.stderr.trim()).slice(0, 500),
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CliError("BAW_INVALID_OUTPUT", "The `baw` command did not return valid JSON.", {
        exitCode: result.exitCode,
      });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new CliError("BAW_INVALID_OUTPUT", "The `baw` command returned a non-object JSON value.");
    }
    const envelope = parsed as BawEnvelope<T>;
    if (typeof envelope.success !== "boolean") {
      throw new CliError("BAW_INVALID_OUTPUT", "The `baw` JSON response is missing a boolean success field.");
    }
    return envelope;
  }

  /** Run a command, throwing a structured `BawCommandError` on `success:false`. */
  async call<T>(args: readonly string[], timeoutMs = 30_000): Promise<T> {
    const envelope = await this.envelope<T>(args, timeoutMs);
    if (envelope.success !== true) {
      throw new BawCommandError(envelope.error ?? { name: "BAW_ERROR", message: "The `baw` command failed." });
    }
    if (envelope.data === undefined) {
      throw new CliError("BAW_INVALID_OUTPUT", "The `baw` command succeeded without returning data.");
    }
    return envelope.data as T;
  }

  /** Local CLI version, not a network call. */
  async version(): Promise<string> {
    const result = await this.runner(["--version"], 10_000);
    const match = result.stdout.trim().match(/\b(\d+\.\d+\.\d+)\b/);
    if (match === null) {
      throw new CliError("BAW_INVALID_OUTPUT", "Could not parse the `baw --version` output.");
    }
    return match[1]!;
  }

  walletStatus(): Promise<BawWalletStatus> {
    return this.call<BawWalletStatus>(["wallet", "status"]);
  }

  walletAddress(): Promise<BawAddressBook> {
    return this.call<BawAddressBook>(["wallet", "address"]);
  }

  walletSettings(): Promise<BawWalletSettings> {
    return this.call<BawWalletSettings>(["wallet", "settings"]);
  }

  walletTxLock(chainId = BSC_BINANCE_CHAIN_ID): Promise<{ status: string }> {
    return this.call<{ status: string }>(["wallet", "tx-lock", "--binanceChainId", chainId]);
  }

  /** Preview a contract call. This is the only external-sign entry point for builds. */
  contractCallPreview(params: PreviewCallParams): Promise<BawContractCallPreview> {
    return this.call<BawContractCallPreview>(
      [
        "contract-call",
        "preview",
        "--binanceChainId",
        BSC_BINANCE_CHAIN_ID,
        "--from",
        params.from,
        "--to",
        params.to,
        "--value",
        params.value.toString(),
        "--inputData",
        params.inputData,
      ],
      90_000,
    );
  }

  /** Execute a previously previewed call. Callers must require explicit confirmation. */
  contractCallExecute(requestId: string): Promise<BawContractCallExecute> {
    return this.call<BawContractCallExecute>(["contract-call", "execute", "--requestId", requestId], 90_000);
  }

  /** Query a transaction status by hash through BAW's tx-history lookup. */
  walletTxHistoryByHash(txHash: string): Promise<BawTxStatus | null> {
    return this.call<BawTxStatus | null>([
      "wallet",
      "tx-history",
      "--tx",
      txHash,
      "--binanceChainId",
      BSC_BINANCE_CHAIN_ID,
    ]);
  }
}

/** Minimal semver comparison for the CLI compatibility check. */
export function versionAtLeast(current: string, required: string): boolean {
  const parse = (value: string): [number, number, number] | null => {
    const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    if (match === null) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const a = parse(current);
  const b = parse(required);
  if (a === null || b === null) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! > b[index]!) return true;
    if (a[index]! < b[index]!) return false;
  }
  return true;
}
