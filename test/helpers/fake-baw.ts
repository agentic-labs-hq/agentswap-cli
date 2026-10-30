import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BawRunner, BawRunnerResult } from "../../src/baw.js";

export interface FakeBaw {
  runner: BawRunner;
  calls: string[][];
}

type FakeResponse =
  | string
  | {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
    }
  | Record<string, unknown>;

/**
 * Build a mocked `baw` runner. Handlers receive the exact argv (including the
 * `--json` suffix the client appends) and can return a raw stdout string or an
 * object that is JSON-encoded.
 */
export function fakeBaw(handler: (args: string[]) => FakeResponse): FakeBaw {
  const calls: string[][] = [];
  const runner: BawRunner = async (args) => {
    const call = [...args];
    calls.push(call);
    const response = handler(call);
    if (typeof response === "string") {
      return { stdout: response, stderr: "", exitCode: 0 };
    }
    if ("stdout" in response || "stderr" in response || "exitCode" in response) {
      const shaped = response as { stdout?: string; stderr?: string; exitCode?: number };
      return {
        stdout: shaped.stdout ?? "",
        stderr: shaped.stderr ?? "",
        exitCode: shaped.exitCode ?? 0,
      } satisfies BawRunnerResult;
    }
    return { stdout: JSON.stringify(response), stderr: "", exitCode: 0 };
  };
  return { runner, calls };
}

/** Envelope for a successful BAW command. */
export function ok<T>(data: T): Record<string, unknown> {
  return { success: true, data };
}

/** Envelope for a failed BAW command. */
export function fail(error: {
  code?: number | string;
  name?: string;
  message?: string;
  data?: unknown;
}): Record<string, unknown> {
  return { success: false, error };
}

export const BSC_ADDRESS = "0x1111111111111111111111111111111111111111";

/** Standard connected-wallet handler used by wallet/preview tests. */
export function connectedBawHandler(options: {
  devMode?: boolean;
  version?: string;
  txLock?: string;
  onPreview?: (args: string[]) => Record<string, unknown>;
  onExecute?: (args: string[]) => Record<string, unknown>;
} = {}): (args: string[]) => FakeResponse {
  return (args) => {
    if (args[0] === "--version") return `${options.version ?? "1.12.0"}\n`;
    if (args[0] === "wallet" && args[1] === "status") return ok({ status: "CONNECTED" });
    if (args[0] === "wallet" && args[1] === "address") {
      return ok({
        addresses: [
          { binanceChainId: "56", chainName: "BSC", address: BSC_ADDRESS },
          { binanceChainId: "1", chainName: "Ethereum", address: "0x2222222222222222222222222222222222222222" },
        ],
      });
    }
    if (args[0] === "wallet" && args[1] === "settings") {
      return ok({
        devMode: { enabled: options.devMode ?? true, expiresAt: 1_800_000_000, dailyLimit: 1000 },
        sessionExpireTime: "2030-01-01T00:00:00+08:00",
      });
    }
    if (args[0] === "wallet" && args[1] === "tx-lock") {
      return ok({ status: options.txLock ?? "UNLOCKED" });
    }
    if (args[0] === "contract-call" && args[1] === "preview") {
      if (options.onPreview) return options.onPreview(args);
      return ok({
        requestId: "req-123",
        parsedTx: { transactionType: "Send", contractAddress: "0x3333333333333333333333333333333333333333" },
        simulationResult: { simulationCode: "000000000", simulationErrorDetail: null, balanceChanges: [] },
        risks: { riskDetails: [] },
        tokenInfos: {},
        requireConfirmation: false,
        expiresAt: 1_800_000_000_000,
      });
    }
    if (args[0] === "contract-call" && args[1] === "execute") {
      if (options.onExecute) return options.onExecute(args);
      return ok({ orderId: "order-1", status: "BROADCASTED", txHash: `0x${"ab".repeat(32)}`, message: null });
    }
    if (args[0] === "wallet" && args[1] === "tx-history") {
      return ok({ binanceChainId: "56", txHash: args[3], status: "SUCCESS", txTime: "2026-01-01T00:00:00+08:00" });
    }
    throw new Error(`Unexpected mocked baw args: ${args.join(" ")}`);
  };
}

export function tempDir(prefix = "agentswap-cli-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
