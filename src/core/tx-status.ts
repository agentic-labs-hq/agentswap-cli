import { CliError, UsageError } from "../errors.js";
import { createStateStore, type StateStore } from "../state.js";
import type { Runtime } from "../runtime.js";
import { baseResult, shortError, type CommandResult } from "./common.js";

export interface TxStatusOptions {
  orderId?: string;
  txHash?: string;
}

export interface TxStatusDeps {
  stateStore?: StateStore;
}

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * `--tx-hash` queries BAW's tx-status endpoint. `--order-id` reads the local
 * journal written by tx execute and, when a txHash is known, enriches it from
 * BAW. BAW 1.11.0 has no contract-call orderId lookup, so the journal is the
 * only way to map an orderId after execution.
 */
export async function runTxStatus(
  runtime: Runtime,
  options: TxStatusOptions,
  deps: TxStatusDeps = {},
): Promise<CommandResult> {
  const hasOrderId = options.orderId !== undefined && options.orderId !== "";
  const hasTxHash = options.txHash !== undefined && options.txHash !== "";
  if (hasOrderId === hasTxHash) {
    throw new UsageError("Provide exactly one of --order-id or --tx-hash.");
  }

  if (hasTxHash) {
    const txHash = options.txHash!;
    if (!TX_HASH_PATTERN.test(txHash)) {
      throw new UsageError("--tx-hash must be a 0x-prefixed 32-byte transaction hash.");
    }
    const data = await runtime.baw.walletTxHistoryByHash(txHash);
    if (data === null) {
      throw new CliError("TX_NOT_FOUND", `No transaction found for ${txHash}.`, { txHash });
    }
    return {
      ...baseResult(runtime, "tx status"),
      source: "baw",
      status: typeof data.status === "string" ? data.status : "UNKNOWN",
      txHash,
      tx: data,
      warnings: [],
    };
  }

  const orderId = options.orderId!.trim();
  if (orderId === "" || orderId.length > 512) throw new UsageError("--order-id is invalid.");
  const store = deps.stateStore ?? createStateStore();
  const record = await store.findExecution(orderId);
  if (record === null) {
    throw new CliError(
      "ORDER_NOT_FOUND",
      `No local record for orderId ${orderId}. BAW 1.11.0 has no contract-call order lookup; use --tx-hash after broadcast or query the Binance App.`,
      { orderId },
    );
  }

  const warnings: string[] = [];
  let tx: unknown = null;
  let status = record.status;
  let refreshed = false;
  if (record.txHash !== null) {
    try {
      tx = await runtime.baw.walletTxHistoryByHash(record.txHash);
      if (tx !== null && typeof tx === "object" && "status" in tx && typeof (tx as { status?: unknown }).status === "string") {
        status = (tx as { status: string }).status;
        refreshed = true;
      } else {
        warnings.push("BAW returned no transaction status for the recorded txHash; keeping the last local status.");
      }
    } catch (error) {
      warnings.push(`Could not refresh on-chain status from BAW: ${shortError(error)}`);
    }
  }

  return {
    ...baseResult(runtime, "tx status"),
    source: "local-journal",
    status,
    orderId,
    requestId: record.requestId,
    txHash: record.txHash,
    record,
    tx,
    lastKnownAt: record.recordedAt,
    freshness: record.txHash === null ? "unknown" : refreshed ? "tx-hash-query" : "stale-local",
    note:
      record.txHash === null
        ? "This is the last local status, not a live chain query. BAW 1.11.0 has no contract-call orderId lookup; confirm in the Binance App and query by txHash once it is available."
        : refreshed
          ? "Status refreshed from BAW tx-history by the recorded txHash."
          : "Could not refresh from BAW; this is the last local status, not a confirmed on-chain status.",
    warnings,
  };
}
