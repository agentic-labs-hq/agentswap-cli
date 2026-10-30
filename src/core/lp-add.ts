import { zeroAddress } from "viem";

import { buildErc20ApproveCall, buildLpMintCall, type PreparedCall } from "../calldata.js";
import { CliError, UsageError } from "../errors.js";
import { planApprovals, type ApprovalStep } from "../lib/approvals.js";
import { assertDistinctAddresses } from "../lib/ordering.js";
import {
  formatTokenAmount,
  parseAddress,
  parseAmount,
  parseBigIntString,
  parseInteger,
} from "../lib/parse.js";
import { validateTickBounds } from "../lib/price.js";
import { validateFeeTier } from "../lib/validate.js";
import { previewCallAndRecord, previewWarnings, type PreviewEnvelope } from "../preview.js";
import type { Runtime } from "../runtime.js";
import { loadWalletForPreview } from "../wallet.js";
import {
  baseResult,
  deadlineFromLatest,
  erc20Meta,
  getPoolState,
  type CommandResult,
  type Erc20Meta,
} from "./common.js";
import { assertLpRecipientsEligible } from "./preflight.js";

export interface LpAddOptions {
  token: string;
  quote: string;
  fee: string;
  tickLower: string;
  tickUpper: string;
  /** Amount of pool token0 (not necessarily `--token`). */
  amount0: string;
  /** Amount of pool token1 (not necessarily `--quote`). */
  amount1: string;
  recipient?: string;
  /** Raw base-unit token0 minimum; required. */
  minAmount0?: string;
  /** Raw base-unit token1 minimum; required. */
  minAmount1?: string;
}

const LP_DEADLINE_SECONDS = 1200;

interface ApprovalPreview {
  step: ApprovalStep;
  meta: Erc20Meta;
  prepared: PreviewEnvelope;
}

/**
 * Build and PREVIEW a gated LP mint. If allowances are insufficient, returns
 * structured `needsApproval` entries with exact approve previews (including
 * USDT-style resets) instead of previewing/signing the mint. Never executes.
 */
export async function runLpAdd(runtime: Runtime, options: LpAddOptions): Promise<CommandResult> {
  const { sdk, deployment } = runtime;
  const token = parseAddress(options.token, "--token");
  const quote = parseAddress(options.quote, "--quote");
  assertDistinctAddresses(token, quote);
  const fee = parseInteger(options.fee, "--fee", { min: 1, max: 0xffffff });
  validateFeeTier(fee);
  const tickLower = parseInteger(options.tickLower, "--tick-lower", { min: -887272, max: 887272 });
  const tickUpper = parseInteger(options.tickUpper, "--tick-upper", { min: -887272, max: 887272 });
  const wallet = await loadWalletForPreview(runtime.baw);
  const recipient = options.recipient === undefined ? wallet.address : parseAddress(options.recipient, "--recipient");

  const pool = await getPoolState(sdk, token, quote, fee);
  const [meta0, meta1] = await Promise.all([erc20Meta(sdk, pool.token0), erc20Meta(sdk, pool.token1)]);
  validateTickBounds({ tickLower, tickUpper, tickSpacing: pool.tickSpacing });

  const amount0 = parseAmount(options.amount0, meta0.decimals, "--amount0");
  const amount1 = parseAmount(options.amount1, meta1.decimals, "--amount1");
  if (amount0 === 0n && amount1 === 0n) {
    throw new CliError("INVALID_AMOUNT", "At least one of --amount0 or --amount1 must be greater than zero.");
  }
  if (options.minAmount0 === undefined || options.minAmount1 === undefined) {
    throw new UsageError(
      "LP mint requires --min-amount0 and --min-amount1 (raw base units). These are encoded into the mint; use 0 only when you explicitly accept no protection on that side.",
    );
  }
  const amount0Min = parseBigIntString(options.minAmount0, "--min-amount0");
  const amount1Min = parseBigIntString(options.minAmount1, "--min-amount1");
  if (amount0Min > amount0 || amount1Min > amount1) {
    throw new CliError("INVALID_MIN_AMOUNT", "--min-amount0/--min-amount1 cannot exceed the desired amount.");
  }

  await assertLpRecipientsEligible(sdk, pool.token0, pool.token1, recipient, wallet.address);

  const npm = deployment.addresses.positionManager!;
  const [balance0, balance1] = await Promise.all([
    sdk.tokens.at(pool.token0).balanceOf(wallet.address),
    sdk.tokens.at(pool.token1).balanceOf(wallet.address),
  ]);
  if (balance0 < amount0) {
    throw new CliError(
      "INSUFFICIENT_BALANCE",
      `Agentic Wallet holds ${formatTokenAmount(balance0, meta0.decimals)} ${meta0.symbol ?? pool.token0}, needs ${formatTokenAmount(amount0, meta0.decimals)} token0.`,
    );
  }
  if (balance1 < amount1) {
    throw new CliError(
      "INSUFFICIENT_BALANCE",
      `Agentic Wallet holds ${formatTokenAmount(balance1, meta1.decimals)} ${meta1.symbol ?? pool.token1}, needs ${formatTokenAmount(amount1, meta1.decimals)} token1.`,
    );
  }

  const [policy0, policy1] = await Promise.all([
    sdk.dex.positionManager().policyOfToken(pool.token0),
    sdk.dex.positionManager().policyOfToken(pool.token1),
  ]);
  const [allowance0, allowance1] = await Promise.all([
    sdk.tokens.at(pool.token0).allowance(wallet.address, npm),
    sdk.tokens.at(pool.token1).allowance(wallet.address, npm),
  ]);

  const approvalSteps = planApprovals(npm, [
    {
      token: pool.token0,
      symbol: meta0.symbol,
      allowance: allowance0,
      amount: amount0,
      gated: policy0 !== zeroAddress,
    },
    {
      token: pool.token1,
      symbol: meta1.symbol,
      allowance: allowance1,
      amount: amount1,
      gated: policy1 !== zeroAddress,
    },
  ]);

  const position = {
    tokenId: null,
    recipient,
    tickLower,
    tickUpper,
    amount0Desired: amount0.toString(),
    amount1Desired: amount1.toString(),
    amount0DesiredHuman: formatTokenAmount(amount0, meta0.decimals),
    amount1DesiredHuman: formatTokenAmount(amount1, meta1.decimals),
    amount0Min: amount0Min.toString(),
    amount1Min: amount1Min.toString(),
    liquidity: null,
  };

  const base = {
    ...baseResult(runtime, "dex lp add"),
    previewOnly: true,
    executed: false,
    wallet: {
      address: wallet.address,
      status: wallet.status,
      devMode: wallet.devModeEnabled,
      source: "binance-agentic-wallet",
    },
    pool: {
      address: pool.address,
      token0: pool.token0,
      token1: pool.token1,
      token0Symbol: meta0.symbol,
      token1Symbol: meta1.symbol,
      token0Decimals: meta0.decimals,
      token1Decimals: meta1.decimals,
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
      currentTick: pool.tick,
      sqrtPriceX96: pool.sqrtPriceX96.toString(),
      liquidity: pool.liquidity.toString(),
    },
    position,
    allowances: [
      {
        token: pool.token0,
        symbol: meta0.symbol,
        spender: npm,
        current: allowance0.toString(),
        currentHuman: formatTokenAmount(allowance0, meta0.decimals),
        required: amount0.toString(),
        requiredHuman: formatTokenAmount(amount0, meta0.decimals),
        sufficient: allowance0 >= amount0,
        gated: policy0 !== zeroAddress,
      },
      {
        token: pool.token1,
        symbol: meta1.symbol,
        spender: npm,
        current: allowance1.toString(),
        currentHuman: formatTokenAmount(allowance1, meta1.decimals),
        required: amount1.toString(),
        requiredHuman: formatTokenAmount(amount1, meta1.decimals),
        sufficient: allowance1 >= amount1,
        gated: policy1 !== zeroAddress,
      },
    ],
  };

  if (approvalSteps.length > 0) {
    const warnings: string[] = [];
    const previews: ApprovalPreview[] = [];
    for (const step of approvalSteps) {
      const meta = step.token === pool.token0 ? meta0 : meta1;
      const call = buildErc20ApproveCall(step.token, step.spender, step.amount);
      const prepared = await previewCallAndRecord(runtime, wallet.address, call);
      previews.push({ step, meta, prepared });
      warnings.push(...previewWarnings(prepared.preview));
      // A reset must execute before the following approve can be simulated.
      // Return the reset preview now and ask the user to re-run after it mines.
      if (step.kind === "reset") break;
    }

    return {
      ...base,
      status: "needsApproval",
      needsApproval: previews.map(({ step, meta, prepared }) => ({
        kind: step.kind,
        token: step.token,
        symbol: meta.symbol,
        decimals: meta.decimals,
        spender: step.spender,
        amount: step.amount.toString(),
        amountHuman: formatTokenAmount(step.amount, meta.decimals),
        resetFirst: step.resetFirst,
        reason: step.reason,
        call: prepared.call,
        preview: prepared.preview,
        nextCommand: prepared.preview.nextCommand,
      })),
      next: {
        note: "Execute each approval preview separately (confirming in the Binance App if required), then re-run this exact command to preview the LP mint.",
        commands: previews.map(({ prepared }) => prepared.preview.nextCommand),
      },
      warnings: [...new Set(warnings)],
    };
  }

  const deadline = await deadlineFromLatest(sdk, LP_DEADLINE_SECONDS);
  const call: PreparedCall = buildLpMintCall({
    positionManager: npm,
    token0: pool.token0,
    token1: pool.token1,
    fee: pool.fee,
    tickLower,
    tickUpper,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min,
    amount1Min,
    recipient,
    deadline,
  });
  const prepared = await previewCallAndRecord(runtime, wallet.address, call);

  return {
    ...base,
    status: "previewed",
    needsApproval: [],
    position: { ...position, deadline: deadline.toString() },
    call: prepared.call,
    preview: prepared.preview,
    next: {
      command: prepared.preview.nextCommand,
      note: "Preview only. Review parsedTx/simulation/risks and confirm; Binance App confirmation may be required.",
    },
    warnings: previewWarnings(prepared.preview),
  };
}
