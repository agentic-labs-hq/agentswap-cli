import { keccak256, type Address, type Hex } from "viem";

import { BawCommandError, type BawClient } from "./baw.js";
import type { PreparedCall } from "./calldata.js";
import { CliError } from "./errors.js";
import type { Runtime } from "./runtime.js";

export interface PreviewReport {
  requestId: string;
  parsedTx: Record<string, unknown> | null;
  simulationResult: Record<string, unknown> | null;
  risks: Record<string, unknown> | null;
  tokenInfos: Record<string, unknown> | null;
  requireConfirmation: boolean;
  expiresAt: number | null;
  nextCommand: string;
}

export interface PreviewEnvelope {
  call: {
    action: string;
    functionName: string;
    to: Address;
    value: string;
    valueWei: string;
    inputData: string;
  };
  preview: PreviewReport;
}

export function executeCommandFor(requestId: string): string {
  return `agentswap tx execute --request-id ${requestId} --confirm`;
}

/** JSON-safe summary of a prepared call (target/function/value/calldata). */
export function callSummary(call: PreparedCall): PreviewEnvelope["call"] {
  return {
    action: call.action,
    functionName: call.functionName,
    to: call.to,
    value: call.value.toString(),
    valueWei: call.value.toString(),
    inputData: call.inputData,
  };
}

/** Human/JSON warnings derived from a BAW preview; no execution. */
export function previewWarnings(report: PreviewReport): string[] {
  const warnings: string[] = [];
  if (report.requireConfirmation) {
    warnings.push("Execution will require confirmation in the Binance App.");
  }
  const simulation = report.simulationResult;
  if (simulation !== null && simulation.simulationErrorDetail !== null && simulation.simulationErrorDetail !== undefined) {
    warnings.push(`Preview simulation reported: ${String(simulation.simulationErrorDetail)}`);
  }
  const risks = report.risks;
  const riskDetails = risks?.riskDetails;
  if (Array.isArray(riskDetails) && riskDetails.length > 0) {
    warnings.push(`Preview returned ${riskDetails.length} transaction-level risk item(s); review them before execute.`);
  }
  return warnings;
}

/** Call `baw contract-call preview`; never executes and never signs. */
export async function previewCall(
  baw: BawClient,
  from: Address,
  call: PreparedCall,
): Promise<PreviewEnvelope> {
  let data;
  try {
    data = await baw.contractCallPreview({
      from,
      to: call.to,
      value: call.value,
      inputData: call.inputData,
    });
  } catch (error) {
    if (error instanceof BawCommandError) {
      throw new CliError("BAW_PREVIEW_REJECTED", error.message, {
        bawError: error.bawError,
        call: {
          action: call.action,
          functionName: call.functionName,
          to: call.to,
          valueWei: call.value.toString(),
          inputData: call.inputData,
        },
      });
    }
    throw error;
  }

  if (typeof data.requestId !== "string" || data.requestId.length === 0) {
    throw new CliError(
      "BAW_INVALID_OUTPUT",
      "The `baw contract-call preview` response did not include a requestId; do not execute.",
    );
  }

  return {
    call: callSummary(call),
    preview: {
      requestId: data.requestId,
      parsedTx: data.parsedTx ?? null,
      simulationResult: data.simulationResult ?? null,
      risks: data.risks ?? null,
      tokenInfos: data.tokenInfos ?? null,
      requireConfirmation: data.requireConfirmation === true,
      expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
      nextCommand: executeCommandFor(data.requestId),
    },
  };
}

/** Preview and persist the requestId binding used by `tx execute`. */
export async function previewCallAndRecord(
  runtime: Runtime,
  from: Address,
  call: PreparedCall,
): Promise<PreviewEnvelope> {
  const envelope = await previewCall(runtime.baw, from, call);
  if (runtime.stateStore !== undefined) {
    await runtime.stateStore.recordPreview({
      requestId: envelope.preview.requestId,
      chainId: runtime.deployment.chainId,
      wallet: from,
      to: call.to,
      value: call.value.toString(),
      inputDataHash: keccak256(call.inputData as Hex),
      action: call.action,
      functionName: call.functionName,
      expiresAt: envelope.preview.expiresAt,
    });
  }
  return envelope;
}
