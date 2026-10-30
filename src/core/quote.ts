import { CliError } from "../errors.js";
import { assertDistinctAddresses } from "../lib/ordering.js";
import { formatTokenAmount, parseAddress, parseInteger, parsePositiveAmount } from "../lib/parse.js";
import { validateFeeTier } from "../lib/validate.js";
import type { Runtime } from "../runtime.js";
import { loadWalletForRead } from "../wallet.js";
import { baseResult, erc20Meta, getPoolState, shortError, type CommandResult } from "./common.js";
import { gatedAssetInfo } from "./preflight.js";

export interface QuoteOptions {
  tokenIn: string;
  tokenOut: string;
  fee: string;
  amountIn: string;
  /** Treat `--amount-in` as the exact output amount and return the required input. */
  exactOut: boolean;
}

/**
 * Read-only quote through the gated-aware Quoter. The simulated caller is the
 * Binance Agentic Wallet BSC address, so gated-output quotes use its policy.
 */
export async function runQuote(runtime: Runtime, options: QuoteOptions): Promise<CommandResult> {
  const { sdk, deployment } = runtime;
  const tokenIn = parseAddress(options.tokenIn, "--token-in");
  const tokenOut = parseAddress(options.tokenOut, "--token-out");
  assertDistinctAddresses(tokenIn, tokenOut, "--token-in", "--token-out");
  const fee = parseInteger(options.fee, "--fee", { min: 1, max: 0xffffff });
  validateFeeTier(fee);

  const wallet = await loadWalletForRead(runtime.baw);
  const [metaIn, metaOut, pool, outGated] = await Promise.all([
    erc20Meta(sdk, tokenIn),
    erc20Meta(sdk, tokenOut),
    getPoolState(sdk, tokenIn, tokenOut, fee),
    gatedAssetInfo(sdk, tokenOut),
  ]);
  const amountDecimals = options.exactOut ? metaOut.decimals : metaIn.decimals;
  const amount = parsePositiveAmount(
    options.amountIn,
    amountDecimals,
    options.exactOut ? "--amount-in (exact output)" : "--amount-in",
  );

  if (outGated.gated) {
    const allowed = await sdk.dex.positionManager().isAllowedRecipient(tokenOut, wallet.address);
    if (!allowed) {
      throw new CliError(
        "QUOTE_CALLER_NOT_AGENT",
        `tokenOut ${tokenOut} is gated and Agentic Wallet ${wallet.address} is not an eligible agent under the token policy.`,
      );
    }
  }

  const quoter = sdk.dex.quoter();
  let amountIn: bigint;
  let amountOut: bigint;
  try {
    if (options.exactOut) {
      amountIn = await quoter.quoteExactOutputSingle({
        tokenIn,
        tokenOut,
        fee,
        amountOut: amount,
        caller: wallet.address,
      });
      amountOut = amount;
    } else {
      amountIn = amount;
      amountOut = await quoter.quoteExactInputSingle({
        tokenIn,
        tokenOut,
        fee,
        amountIn: amount,
        caller: wallet.address,
      });
    }
  } catch (error) {
    throw new CliError(
      "QUOTE_FAILED",
      `Quoter reverted for ${tokenIn} -> ${tokenOut} at fee ${fee}: ${shortError(error)}`,
    );
  }

  const blockNumber = await sdk.publicClient.getBlockNumber({ cacheTime: 0 });

  return {
    ...baseResult(runtime, "dex quote"),
    blockNumber: blockNumber.toString(),
    quoter: deployment.addresses.quoter!,
    wallet: {
      address: wallet.address,
      status: wallet.status,
      source: "binance-agentic-wallet",
    },
    quote: {
      tokenIn,
      tokenOut,
      tokenInSymbol: metaIn.symbol,
      tokenOutSymbol: metaOut.symbol,
      tokenInDecimals: metaIn.decimals,
      tokenOutDecimals: metaOut.decimals,
      fee,
      exact: options.exactOut ? "output" : "input",
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountInHuman: formatTokenAmount(amountIn, metaIn.decimals),
      amountOutHuman: formatTokenAmount(amountOut, metaOut.decimals),
      caller: wallet.address,
      callerSource: "binance-agentic-wallet",
      pool: pool.address,
      sqrtPriceLimitX96: "0",
    },
    warnings: [],
  };
}
