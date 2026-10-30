import type { Address } from "viem";

import {
  buildLpBurnCall,
  buildLpCollectCall,
  buildLpDecreaseCall,
  MAX_UINT128,
  type PreparedCall,
} from "../calldata.js";
import { CliError, UsageError } from "../errors.js";
import { planLpRemove, type LpRemoveStepKind } from "../lib/liquidity.js";
import { sameAddress } from "../lib/ordering.js";
import { parseBigIntString } from "../lib/parse.js";
import { callSummary, previewCallAndRecord, previewWarnings, type PreviewEnvelope } from "../preview.js";
import type { Runtime } from "../runtime.js";
import { loadWalletForPreview } from "../wallet.js";
import { baseResult, deadlineFromLatest, erc20Meta, shortError, type CommandResult } from "./common.js";

export interface LpRemoveOptions {
  tokenId: string;
  /** Omitted = full liquidity; a raw uint128 amount or a percentage like "50%". */
  liquidity?: string;
  /** Raw token0 base-unit minimum; required when a decrease step is present. */
  minAmount0?: string;
  /** Raw token1 base-unit minimum; required when a decrease step is present. */
  minAmount1?: string;
  noCollect?: boolean;
  noBurn?: boolean;
  /** Skip decrease and only finish an already-completed removal (collect/burn). */
  collectOnly?: boolean;
}

interface StepPreview {
  index: number;
  kind: LpRemoveStepKind;
  description: string;
  call: PreviewEnvelope["call"];
  preview: PreviewEnvelope["preview"] | null;
  requestId: string | null;
  nextCommand: string | null;
  error: { code: string; message: string } | null;
}

const REMOVE_DEADLINE_SECONDS = 1200;

/**
 * Build and PREVIEW an LP removal sequence: decrease liquidity, collect max,
 * then burn (unless disabled). Preview steps are independent; later steps may
 * not be previewable before earlier steps are mined, so the result is marked
 * requiresSequentialExecution. No execution and no local signing.
 */
export async function runLpRemove(runtime: Runtime, options: LpRemoveOptions): Promise<CommandResult> {
  const { sdk, deployment } = runtime;
  const tokenId = parseBigIntString(options.tokenId, "--token-id");

  const wallet = await loadWalletForPreview(runtime.baw);
  const npm = deployment.addresses.positionManager!;
  const npmActions = sdk.dex.positionManager();

  let position: Awaited<ReturnType<typeof npmActions.positions>>;
  try {
    position = await npmActions.positions(tokenId);
  } catch (error) {
    throw new CliError("POSITION_NOT_FOUND", `Position ${tokenId} could not be read: ${shortError(error)}`);
  }

  let owner: Address;
  try {
    owner = await npmActions.ownerOf(tokenId);
  } catch (error) {
    throw new CliError("POSITION_NOT_FOUND", `Position ${tokenId} has no readable owner: ${shortError(error)}`);
  }
  if (!sameAddress(owner, wallet.address)) {
    throw new CliError(
      "NOT_POSITION_OWNER",
      `Position ${tokenId} is owned by ${owner}, not by the Binance Agentic Wallet ${wallet.address}.`,
    );
  }
  if (
    options.noCollect === true &&
    options.noBurn !== true &&
    (position.liquidity > 0n || position.tokensOwed0 > 0n || position.tokensOwed1 > 0n)
  ) {
    throw new CliError(
      "BURN_REQUIRES_COLLECT",
      "A burn requires zero liquidity and zero tokensOwed. Use --no-burn for a decrease-only preview, or allow collect and use --collect-only after the decrease confirms.",
    );
  }

  const plan = planLpRemove({
    currentLiquidity: position.liquidity,
    ...(options.liquidity === undefined ? {} : { requested: options.liquidity }),
    noCollect: options.noCollect === true,
    noBurn: options.noBurn === true,
    ...(options.collectOnly === true ? { collectOnly: true } : {}),
  });

  const hasDecrease = plan.steps.some((step) => step.kind === "decrease");
  const amount0Min = options.minAmount0 === undefined ? null : parseBigIntString(options.minAmount0, "--min-amount0");
  const amount1Min = options.minAmount1 === undefined ? null : parseBigIntString(options.minAmount1, "--min-amount1");
  if (hasDecrease && (amount0Min === null || amount1Min === null)) {
    throw new UsageError(
      "LP decrease requires --min-amount0 and --min-amount1 (raw base units). Set a deliberate minimum; use 0 only if you explicitly accept no protection on that side.",
    );
  }

  const [meta0, meta1] = await Promise.all([erc20Meta(sdk, position.token0), erc20Meta(sdk, position.token1)]);
  const deadline = plan.steps.some((step) => step.kind === "decrease")
    ? await deadlineFromLatest(sdk, REMOVE_DEADLINE_SECONDS)
    : null;

  const built: Array<{
    kind: LpRemoveStepKind;
    description: string;
    call: PreparedCall;
  }> = [];
  for (const step of plan.steps) {
    if (step.kind === "decrease") {
      built.push({
        kind: step.kind,
        description: step.description,
        call: buildLpDecreaseCall({
          positionManager: npm,
          tokenId,
          liquidity: plan.selection.liquidity,
          amount0Min: amount0Min!,
          amount1Min: amount1Min!,
          deadline: deadline!,
        }),
      });
    } else if (step.kind === "collect") {
      built.push({
        kind: step.kind,
        description: step.description,
        call: buildLpCollectCall({
          positionManager: npm,
          tokenId,
          recipient: wallet.address,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        }),
      });
    } else {
      built.push({
        kind: step.kind,
        description: step.description,
        call: buildLpBurnCall(npm, tokenId),
      });
    }
  }

  const warnings: string[] = [];
  if (hasDecrease) {
    warnings.push(
      `decreaseLiquidity minimums are enforced: amount0Min=${amount0Min} amount1Min=${amount1Min} (raw base units).`,
    );
  }
  if (built.length > 1) {
    warnings.push(
      "Removal steps are state-dependent. Execute them in order; do not re-run the decrease. Use the recovery command only after the decrease confirms.",
    );
  }

  const orderedSteps: StepPreview[] = [];
  for (let index = 0; index < built.length; index += 1) {
    const step = built[index]!;
    try {
      const prepared = await previewCallAndRecord(runtime, wallet.address, step.call);
      orderedSteps.push({
        index: index + 1,
        kind: step.kind,
        description: step.description,
        call: prepared.call,
        preview: prepared.preview,
        requestId: prepared.preview.requestId,
        nextCommand: prepared.preview.nextCommand,
        error: null,
      });
      warnings.push(...previewWarnings(prepared.preview));
    } catch (error) {
      if (error instanceof CliError && error.code === "BAW_PREVIEW_REJECTED") {
        orderedSteps.push({
          index: index + 1,
          kind: step.kind,
          description: step.description,
          call: callSummary(step.call),
          preview: null,
          requestId: null,
          nextCommand: null,
          error: { code: error.code, message: error.message },
        });
        warnings.push(`${step.kind} preview was rejected: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  const rejected = orderedSteps.filter((step) => step.error !== null);
  const successfulCommands = orderedSteps
    .filter((step) => step.nextCommand !== null)
    .map((step) => step.nextCommand!);
  const liquidityArg =
    plan.remainingLiquidity > 0n && options.liquidity !== undefined ? ` --liquidity ${options.liquidity}` : "";
  const decreasePreviewed = orderedSteps.some((step) => step.kind === "decrease" && step.error === null);
  const baseRecoveryCommand = `agentswap dex lp remove --token-id ${tokenId.toString()}`;
  const normalRePreviewCommand = `${baseRecoveryCommand}${liquidityArg}${
    options.noCollect === true ? " --no-collect" : ""
  }${options.noBurn === true ? " --no-burn" : ""}`;
  const recoveryAfterDecrease =
    options.noCollect === true
      ? null
      : `${baseRecoveryCommand} --collect-only${options.noBurn === true ? " --no-burn" : ""}`;
  const rePreviewCommand = decreasePreviewed
    ? null
    : options.collectOnly === true
      ? recoveryAfterDecrease
      : normalRePreviewCommand;

  const nextNote =
    rejected.length > 0
      ? recoveryAfterDecrease === null
        ? `Execute the successful previews in order. Do not re-run the decrease. No automatic recovery command is available for this flag combination.`
        : `Execute the successful previews in order. Do not re-run the decrease. If the decrease has confirmed, run: ${recoveryAfterDecrease}.`
      : built.length > 1
        ? recoveryAfterDecrease === null
          ? `Execute the previews in order: ${successfulCommands.join(" ; ")}. Do not re-run the decrease; no automatic recovery command is available for this flag combination.`
          : `Execute the previews in order: ${successfulCommands.join(" ; ")}. If a later execute fails because an earlier step has not mined, do not re-run the decrease; after it confirms run: ${recoveryAfterDecrease}.`
        : "Preview only. Execute separately with tx execute after reviewing the BAW preview.";

  if (rejected.length > 0) {
    warnings.push(
      `${rejected.length} step(s) could not be previewed yet (${rejected.map((step) => step.kind).join(", ")}). Execute the earlier steps first; do not re-run the decrease.`,
    );
  }

  return {
    ...baseResult(runtime, "dex lp remove"),
    previewOnly: true,
    executed: false,
    wallet: {
      address: wallet.address,
      status: wallet.status,
      devMode: wallet.devModeEnabled,
      source: "binance-agentic-wallet",
    },
    positionManager: npm,
    position: {
      tokenId: tokenId.toString(),
      owner,
      token0: position.token0,
      token0Symbol: meta0.symbol,
      token0Decimals: meta0.decimals,
      token1: position.token1,
      token1Symbol: meta1.symbol,
      token1Decimals: meta1.decimals,
      fee: position.fee,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      currentLiquidity: position.liquidity.toString(),
      tokensOwed0: position.tokensOwed0.toString(),
      tokensOwed1: position.tokensOwed1.toString(),
    },
    liquidity: {
      requested: options.liquidity ?? null,
      selected: plan.selection.liquidity.toString(),
      mode: plan.selection.mode,
      percent: plan.selection.percent,
      remaining: plan.remainingLiquidity.toString(),
      full: plan.selection.liquidity === position.liquidity,
    },
    collect: options.noCollect !== true,
    burn: options.noBurn !== true,
    collectRecipient: wallet.address,
    amount0Min: amount0Min === null ? null : amount0Min.toString(),
    amount1Min: amount1Min === null ? null : amount1Min.toString(),
    deadline: deadline === null ? null : deadline.toString(),
    requiresSequentialExecution: built.length > 1 || rejected.length > 0,
    orderedSteps,
    next: {
      note: nextNote,
      commands: successfulCommands,
      rePreviewCommand,
      recoveryAfterDecrease,
      recoveryCondition: "Use recoveryAfterDecrease only after the decrease transaction has confirmed.",
    },
    warnings: [...new Set(warnings)],
  };
}
