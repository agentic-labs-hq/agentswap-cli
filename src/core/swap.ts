import { zeroAddress } from "viem";

import { buildErc20ApproveCall, buildNativeOutSwapCall, buildSwapCall, type PreparedCall } from "../calldata.js";
import { CliError } from "../errors.js";
import { planApprovals, type ApprovalStep } from "../lib/approvals.js";
import { assertDistinctAddresses } from "../lib/ordering.js";
import {
  formatTokenAmount,
  parseAddress,
  parseAmount,
  parseDeadlineSeconds,
  parseInteger,
  parsePositiveAmount,
} from "../lib/parse.js";
import { assertNotNativeToNative, resolveSwapInput, resolveSwapOutput } from "../lib/native.js";
import { validateFeeTier } from "../lib/validate.js";
import { previewCallAndRecord, previewWarnings, type PreviewEnvelope } from "../preview.js";
import type { Runtime } from "../runtime.js";
import { loadWalletForPreview } from "../wallet.js";
import {
  baseResult,
  deadlineFromLatest,
  erc20Meta,
  getPoolState,
  shortError,
  type CommandResult,
} from "./common.js";
import { assertSwapEligible } from "./preflight.js";

export interface SwapOptions {
  tokenIn: string;
  tokenOut: string;
  fee: string;
  amountIn: string;
  minOut: string;
  recipient?: string;
  /** Seconds from now; defaults to 600. */
  deadline?: string;
  /** Unwrap the WBNB output to native BNB via router multicall. */
  nativeOut?: boolean;
}

interface ApprovalPreview {
  step: ApprovalStep;
  prepared: PreviewEnvelope;
}

/**
 * Build and PREVIEW an exact-input swap. ERC-20 input with insufficient
 * allowance returns `needsApproval` previews instead of previewing the swap;
 * native BNB input sets the preview `--value` to the input amount. Never executes.
 */
export async function runSwap(runtime: Runtime, options: SwapOptions): Promise<CommandResult> {
  const { sdk, deployment } = runtime;
  const deadlineSeconds = parseDeadlineSeconds(options.deadline);
  const fee = parseInteger(options.fee, "--fee", { min: 1, max: 0xffffff });
  validateFeeTier(fee);

  const nativeOut = options.nativeOut === true;
  const resolvedIn = resolveSwapInput(options.tokenIn, deployment.wbnb, "--token-in");
  const resolvedOut = resolveSwapOutput(options.tokenOut, nativeOut, deployment.wbnb);
  assertNotNativeToNative(resolvedIn.isNative, resolvedOut.isNative);
  const tokenOut = resolvedOut.token;
  assertDistinctAddresses(resolvedIn.token, tokenOut, "--token-in", "--token-out");

  const wallet = await loadWalletForPreview(runtime.baw);
  const recipient = options.recipient === undefined ? wallet.address : parseAddress(options.recipient, "--recipient");

  const [metaIn, metaOut, pool] = await Promise.all([
    erc20Meta(sdk, resolvedIn.token),
    erc20Meta(sdk, tokenOut),
    getPoolState(sdk, resolvedIn.token, tokenOut, fee),
  ]);
  const amountIn = parsePositiveAmount(
    options.amountIn,
    resolvedIn.isNative ? 18 : metaIn.decimals,
    "--amount-in",
  );
  const minOut = parseAmount(options.minOut, nativeOut ? 18 : metaOut.decimals, "--min-out");

  await assertSwapEligible(sdk, resolvedIn.token, tokenOut, wallet.address, recipient);

  const warnings: string[] = [];
  if (minOut === 0n) warnings.push("--min-out is zero; the swap has no slippage protection.");
  if (resolvedIn.isNative) {
    warnings.push(
      `Native BNB input: calldata uses WBNB ${deployment.wbnb} and the preview value is ${amountIn.toString()} wei.`,
    );
  }
  if (nativeOut) {
    warnings.push(
      "Native BNB output: exactInputSingle sends WBNB to the router, then unwrapWETH9 sends BNB to the recipient. The BAW preview should show a native balance increase and no WBNB retained in the wallet.",
    );
  }

  let quotedOut: bigint | null = null;
  try {
    quotedOut = await sdk.dex.quoter().quoteExactInputSingle({
      tokenIn: resolvedIn.token,
      tokenOut,
      fee,
      amountIn,
      caller: wallet.address,
    });
    if (quotedOut < minOut) {
      throw new CliError(
        "MIN_OUT_TOO_HIGH",
        `--min-out ${formatTokenAmount(minOut, metaOut.decimals)} exceeds the current quote ${formatTokenAmount(quotedOut, metaOut.decimals)}; the swap would revert.`,
      );
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    warnings.push(`Pre-swap quote failed (preview simulation will still run): ${shortError(error)}`);
  }

  const router = deployment.addresses.swapRouter!;
  const tokenInSymbol = resolvedIn.isNative ? "BNB" : metaIn.symbol;
  const swapBase = {
    ...baseResult(runtime, "dex swap"),
    previewOnly: true,
    executed: false,
    wallet: {
      address: wallet.address,
      status: wallet.status,
      devMode: wallet.devModeEnabled,
      source: "binance-agentic-wallet",
    },
    swap: {
      tokenIn: options.tokenIn,
      tokenInResolved: resolvedIn.token,
      tokenInSymbol,
      nativeIn: resolvedIn.isNative,
      tokenOut: options.tokenOut,
      tokenOutResolved: tokenOut,
      tokenOutSymbol: nativeOut ? "BNB" : metaOut.symbol,
      nativeOut,
      tokenInDecimals: resolvedIn.isNative ? 18 : metaIn.decimals,
      tokenOutDecimals: nativeOut ? 18 : metaOut.decimals,
      fee,
      amountIn: amountIn.toString(),
      amountInHuman: formatTokenAmount(amountIn, resolvedIn.isNative ? 18 : metaIn.decimals),
      amountOutMinimum: minOut.toString(),
      amountOutMinimumHuman: formatTokenAmount(minOut, nativeOut ? 18 : metaOut.decimals),
      quotedAmountOut: quotedOut === null ? null : quotedOut.toString(),
      quotedAmountOutHuman: quotedOut === null ? null : formatTokenAmount(quotedOut, nativeOut ? 18 : metaOut.decimals),
      recipient,
      deadlineSeconds,
      pool: pool.address,
      exact: "input",
      valueWei: nativeOut ? "0" : resolvedIn.isNative ? amountIn.toString() : "0",
    },
  };

  if (!resolvedIn.isNative) {
    const allowance = await sdk.tokens.at(resolvedIn.token).allowance(wallet.address, router);
    const gated = (await sdk.dex.positionManager().policyOfToken(resolvedIn.token)) !== zeroAddress;
    const approvalSteps = planApprovals(router, [
      {
        token: resolvedIn.token,
        symbol: metaIn.symbol,
        allowance,
        amount: amountIn,
        gated,
      },
    ]);

    if (approvalSteps.length > 0) {
      const approvalWarnings: string[] = [...warnings];
      const previews: ApprovalPreview[] = [];
      for (const step of approvalSteps) {
        const prepared = await previewCallAndRecord(
          runtime,
          wallet.address,
          buildErc20ApproveCall(step.token, step.spender, step.amount),
        );
        previews.push({ step, prepared });
        approvalWarnings.push(...previewWarnings(prepared.preview));
        // The dependent approve cannot be simulated until the reset is mined.
        if (step.kind === "reset") break;
      }
      return {
        ...swapBase,
        status: "needsApproval",
        swap: { ...swapBase.swap, deadline: null },
        allowances: [
          {
            token: resolvedIn.token,
            symbol: metaIn.symbol,
            spender: router,
            current: allowance.toString(),
            currentHuman: formatTokenAmount(allowance, metaIn.decimals),
            required: amountIn.toString(),
            requiredHuman: formatTokenAmount(amountIn, metaIn.decimals),
            sufficient: false,
            gated,
          },
        ],
        needsApproval: previews.map(({ step, prepared }) => ({
          kind: step.kind,
          token: step.token,
          symbol: step.symbol,
          spender: step.spender,
          amount: step.amount.toString(),
          amountHuman: formatTokenAmount(step.amount, metaIn.decimals),
          resetFirst: step.resetFirst,
          reason: step.reason,
          call: prepared.call,
          preview: prepared.preview,
          nextCommand: prepared.preview.nextCommand,
        })),
        next: {
          note: "Execute each approval preview separately (confirming in the Binance App if required), then re-run this exact swap command to preview the swap.",
          commands: previews.map(({ prepared }) => prepared.preview.nextCommand),
        },
        warnings: [...new Set(approvalWarnings)],
      };
    }
  }

  const deadline = await deadlineFromLatest(sdk, deadlineSeconds);
  const call: PreparedCall = nativeOut
    ? buildNativeOutSwapCall({
        router,
        tokenIn: resolvedIn.token,
        tokenOut,
        fee,
        recipient,
        deadline,
        amountIn,
        amountOutMinimum: minOut,
      })
    : buildSwapCall({
        router,
        tokenIn: resolvedIn.token,
        tokenOut,
        fee,
        recipient,
        deadline,
        amountIn,
        amountOutMinimum: minOut,
        value: resolvedIn.isNative ? amountIn : 0n,
      });
  const prepared = await previewCallAndRecord(runtime, wallet.address, call);

  return {
    ...swapBase,
    status: "previewed",
    swap: { ...swapBase.swap, deadline: deadline.toString() },
    needsApproval: [],
    call: prepared.call,
    preview: prepared.preview,
    next: {
      command: prepared.preview.nextCommand,
      note: nativeOut
        ? "Preview only. Verify the BAW simulation shows a native BNB balance increase and no WBNB retained before confirming. Binance App confirmation may be required."
        : "Preview only. Review parsedTx/simulation/risks and confirm; Binance App confirmation may be required.",
    },
    warnings: [...new Set([...warnings, ...previewWarnings(prepared.preview)])],
  };
}
