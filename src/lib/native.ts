import type { Address } from "viem";

import { CliError } from "../errors.js";
import { parseAddress } from "./parse.js";

/** Native BNB sentinel used by Binance's token lists. */
export const NATIVE_BNB_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const NATIVE_ALIASES = new Set(["bnb", "native", "eth"]);

export function isNativeBnbToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return NATIVE_ALIASES.has(normalized) || normalized === NATIVE_BNB_ADDRESS.toLowerCase();
}

export interface ResolvedSwapInput {
  /** Address used in calldata (WBNB for native input). */
  token: Address;
  isNative: boolean;
}

/** Resolve `--token-in` into a calldata token and native-value flag. */
export function resolveSwapInput(value: string, wbnb: Address, label = "--token-in"): ResolvedSwapInput {
  if (isNativeBnbToken(value)) return { token: wbnb, isNative: true };
  return { token: parseAddress(value, label), isNative: false };
}

export interface ResolvedSwapOutput {
  /** Address used in calldata (WBNB for native output). */
  token: Address;
  isNative: boolean;
}

/** Resolve `--token-out`; native output requires `--native-out`, and vice versa. */
export function resolveSwapOutput(value: string, nativeOut: boolean, wbnb: Address): ResolvedSwapOutput {
  const isNativeAlias = isNativeBnbToken(value);
  if (nativeOut && !isNativeAlias) {
    throw new CliError(
      "NATIVE_OUT_MISMATCH",
      "--native-out requires --token-out to be a native alias (BNB, native, ETH, or the 0xEeee... sentinel).",
    );
  }
  if (!nativeOut && isNativeAlias) {
    throw new CliError(
      "NATIVE_OUT_REQUIRED",
      "Native BNB output requires --native-out; without it, use the WBNB address for an ERC-20 output.",
    );
  }
  return { token: isNativeAlias ? wbnb : parseAddress(value, "--token-out"), isNative: isNativeAlias };
}

/** BNB -> BNB is never a valid swap. */
export function assertNotNativeToNative(nativeIn: boolean, nativeOut: boolean): void {
  if (nativeIn && nativeOut) {
    throw new CliError(
      "NATIVE_TO_NATIVE_UNSUPPORTED",
      "BNB -> BNB is not supported. Use an ERC-20 input with --native-out, or remove --native-out.",
    );
  }
}
