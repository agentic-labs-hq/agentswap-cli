import { zeroAddress } from "viem";

import { buildPoolCreateCall } from "../calldata.js";
import { CliError, UsageError } from "../errors.js";
import { sameAddress, sortTokenPair } from "../lib/ordering.js";
import { parseAddress, parseBigIntString, parseInteger } from "../lib/parse.js";
import { assertSqrtPriceX96, priceToSqrtPriceX96 } from "../lib/price.js";
import { validateFeeTier } from "../lib/validate.js";
import { previewCallAndRecord, previewWarnings } from "../preview.js";
import type { Runtime } from "../runtime.js";
import { loadWalletForPreview } from "../wallet.js";
import { baseResult, erc20Meta, type CommandResult } from "./common.js";
import { assertPoolCreatePreflight, type GatedAssetInfo } from "./preflight.js";

export interface PoolCreateOptions {
  token: string;
  quote: string;
  fee: string;
  price?: string;
  sqrtPriceX96?: string;
}

/** Build and PREVIEW a gated pool creation through the Binance Agentic Wallet. */
export async function runPoolCreate(runtime: Runtime, options: PoolCreateOptions): Promise<CommandResult> {
  const { sdk, deployment } = runtime;
  const token = parseAddress(options.token, "--token");
  const quote = parseAddress(options.quote, "--quote");
  if (sameAddress(token, quote)) throw new CliError("IDENTICAL_TOKENS", "--token and --quote must differ.");
  const fee = parseInteger(options.fee, "--fee", { min: 1, max: 0xffffff });
  validateFeeTier(fee);

  if ((options.price === undefined) === (options.sqrtPriceX96 === undefined)) {
    throw new UsageError("Provide exactly one of --price or --sqrt-price-x96.");
  }

  const wallet = await loadWalletForPreview(runtime.baw);
  const [tokenMeta, quoteMeta] = await Promise.all([erc20Meta(sdk, token), erc20Meta(sdk, quote)]);
  const poolFactory = sdk.dex.poolFactory();
  const [feeAllowed, preflight] = await Promise.all([
    poolFactory.isAllowedFee(fee),
    assertPoolCreatePreflight(sdk, token, quote, wallet.address),
  ]);
  if (!feeAllowed) {
    throw new CliError("FEE_NOT_ALLOWED", `Fee tier ${fee} is not enabled on the gated pool factory.`);
  }

  const [token0, token1] = sortTokenPair(token, quote);
  const tokenIsToken0 = sameAddress(token0, token);
  let sqrtPriceX96: bigint;
  if (options.sqrtPriceX96 !== undefined) {
    sqrtPriceX96 = parseBigIntString(options.sqrtPriceX96, "--sqrt-price-x96");
    assertSqrtPriceX96(sqrtPriceX96);
  } else {
    sqrtPriceX96 = priceToSqrtPriceX96({
      price: options.price!,
      tokenDecimals: tokenMeta.decimals,
      quoteDecimals: quoteMeta.decimals,
      tokenIsToken0,
    });
  }

  const existingPool = await sdk.dex.getPool(token, quote, fee);
  if (!sameAddress(existingPool, zeroAddress)) {
    throw new CliError("POOL_EXISTS", `Pool already exists at ${existingPool} for this pair/fee.`, {
      pool: existingPool,
    });
  }

  const canonicalFactory = deployment.addresses.canonicalFactory!;
  const tickSpacing = await sdk.dex.canonicalFactory(canonicalFactory).feeAmountTickSpacing(fee);
  if (tickSpacing <= 0) throw new CliError("FEE_NOT_ALLOWED", `Canonical factory has no tick spacing for fee ${fee}.`);

  const call = buildPoolCreateCall({
    factory: deployment.addresses.gatedPoolFactory!,
    tokenA: token,
    tokenB: quote,
    fee,
    sqrtPriceX96,
  });
  const prepared = await previewCallAndRecord(runtime, wallet.address, call);

  return {
    ...baseResult(runtime, "dex pool create"),
    previewOnly: true,
    executed: false,
    wallet: {
      address: wallet.address,
      status: wallet.status,
      devMode: wallet.devModeEnabled,
      source: "binance-agentic-wallet",
    },
    pool: {
      address: null,
      token0,
      token1,
      token0Symbol: sameAddress(token0, token) ? tokenMeta.symbol : quoteMeta.symbol,
      token1Symbol: sameAddress(token1, token) ? tokenMeta.symbol : quoteMeta.symbol,
      fee,
      tickSpacing,
      sqrtPriceX96: sqrtPriceX96.toString(),
      price: options.price ?? null,
      priceDefinition: "quote token units per one token unit",
    },
    tokens: {
      token: tokenMeta,
      quote: quoteMeta,
      tokenIsToken0,
    },
    gated: {
      token: gatedReport(preflight.token),
      quote: gatedReport(preflight.quote),
    },
    call: prepared.call,
    preview: prepared.preview,
    next: {
      command: prepared.preview.nextCommand,
      note: "Preview only. Pool creation is creator-authorized; the Agentic Wallet must be the creator of every gated side.",
    },
    warnings: previewWarnings(prepared.preview),
  };
}

function gatedReport(info: GatedAssetInfo): { gated: boolean; creator: string | null; policy: string | null } {
  return { gated: info.gated, creator: info.creator, policy: info.policy };
}
