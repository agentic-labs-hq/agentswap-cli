import { sortTokenPair as sdkSortTokenPair } from "../vendor/sdk/index.js";
import type { Address } from "viem";

import { CliError } from "../errors.js";

export function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Sort a pair the way Uniswap V3 does, with a CLI-friendly error for self-pairs. */
export function sortTokenPair(tokenA: Address, tokenB: Address): [Address, Address] {
  if (sameAddress(tokenA, tokenB)) {
    throw new CliError("IDENTICAL_TOKENS", "token and quote must be different addresses.");
  }
  try {
    return sdkSortTokenPair(tokenA, tokenB);
  } catch (error) {
    throw new CliError("TOKEN_ORDER", "Could not sort the token pair.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function assertDistinctAddresses(tokenA: Address, tokenB: Address, labelA = "token", labelB = "quote"): void {
  if (sameAddress(tokenA, tokenB)) {
    throw new CliError("IDENTICAL_TOKENS", `${labelA} and ${labelB} must be different addresses.`);
  }
}

/** Whether `token` is token0 of the sorted pair. */
export function isToken0(token: Address, quote: Address): boolean {
  const [token0] = sortTokenPair(token, quote);
  return sameAddress(token0, token);
}
