import { CliError, UsageError } from "../errors.js";
import { createStateStore, type StateStore } from "../state.js";
import type { Runtime } from "../runtime.js";
import { baseResult, shortError, type CommandResult } from "./common.js";
import { assertDevMode, loadWalletForRead } from "../wallet.js";

export interface TxExecuteOptions {
  requestId: string;
  confirm: boolean;
}

export interface TxExecuteDeps {
  stateStore?: StateStore;
}

/**
 * The ONLY execution path. Requires an explicit confirmation flag and a
 * requestId produced by a previous preview. Signing happens inside the Binance
 * Agentic Wallet / Binance App; this process never handles a key.
 */
export async function runTxExecute(
  runtime: Runtime,
  options: TxExecuteOptions,
  deps: TxExecuteDeps = {},
): Promise<CommandResult> {
  if (options.confirm !== true) {
    throw new CliError(
      "CONFIRM_REQUIRED",
      "Refusing to execute without explicit confirmation. Re-run with `agentswap tx execute --request-id <id> --confirm` after reviewing the preview.",
    );
  }
  const requestId = options.requestId.trim();
  if (requestId === "") throw new CliError("REQUEST_ID_REQUIRED", "--request-id is required.");
  if (requestId.length > 512) throw new UsageError("--request-id is too long.");

  // Developer Mode is required for external signing; re-check at execute time.
  await assertDevMode(runtime.baw);

  // The requestId must be one this tool previewed, for this chain and wallet.
  // Consume it before calling BAW so a request cannot be replayed.
  const store = deps.stateStore ?? runtime.stateStore ?? createStateStore();
  const wallet = await loadWalletForRead(runtime.baw);
  const preview = await store.consumePreview(requestId, {
    chainId: runtime.deployment.chainId,
    wallet: wallet.address,
  });

  const data = await runtime.baw.contractCallExecute(requestId);
  const status = typeof data.status === "string" ? data.status : "UNKNOWN";
  const orderId = typeof data.orderId === "string" && data.orderId.length > 0 ? data.orderId : null;
  const txHash = typeof data.txHash === "string" && data.txHash.length > 0 ? data.txHash : null;
  const message = typeof data.message === "string" ? data.message : null;

  const warnings: string[] = [];
  if (orderId !== null) {
    try {
      await store.recordExecution({ requestId, orderId, status, txHash, message });
    } catch (error) {
      warnings.push(`Execution succeeded but the local tx journal could not be updated: ${shortError(error)}`);
    }
  }

  const next =
    status === "PENDING_CONFIRMATION"
      ? {
          action: "confirm-in-binance-app",
          note: "Confirm or reject in the Binance App. After it broadcasts, obtain the txHash from the App/BAW and query --tx-hash. The local orderId does not refresh itself and is not a live status.",
          command: "agentswap tx status --tx-hash <txHash>",
        }
      : txHash !== null
        ? {
            action: "track-on-chain",
            note: "The transaction was broadcast. Track it on-chain by hash.",
            command: `agentswap tx status --tx-hash ${txHash}`,
          }
        : {
            action: "status-unknown",
            note: "No txHash was returned. Check the Binance App or BAW tx history.",
            command: orderId === null ? null : `agentswap tx status --order-id ${orderId}`,
          };

  return {
    ...baseResult(runtime, "tx execute"),
    previewOnly: false,
    executed: true,
    requestId,
    preview,
    orderId,
    status,
    txHash,
    message,
    next,
    warnings,
  };
}
