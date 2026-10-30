import { zeroAddress, type Address } from "viem";
import { type Sdk } from "../vendor/sdk/index.js";

import { CliError } from "../errors.js";
import { formatTokenAmount } from "../lib/parse.js";
import type { Runtime } from "../runtime.js";

export type CommandResult = Record<string, unknown>;
export type CheckStatus = "ok" | "fail" | "warn";

export interface Check {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface Erc20Meta {
  address: Address;
  symbol: string | null;
  decimals: number;
}

/** Common metadata present in every command result. */
export function baseResult(runtime: Runtime, command: string): CommandResult {
  return {
    ok: true,
    command,
    chainId: runtime.deployment.chainId,
    network: runtime.deployment.network,
    rpcHost: runtime.rpcHost,
  };
}

export function gwei(wei: bigint): string {
  return formatTokenAmount(wei, 9);
}

export function shortError(error: unknown): string {
  if (error !== null && typeof error === "object" && "shortMessage" in error) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof short === "string" && short.length > 0) return short;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Read symbol and decimals; symbol is optional for exotic ERC-20s. */
export async function erc20Meta(sdk: Sdk, address: Address): Promise<Erc20Meta> {
  const token = sdk.tokens.at(address);
  let decimals: number;
  try {
    decimals = await token.decimals();
  } catch (error) {
    throw new CliError("TOKEN_METADATA", `Could not read decimals() for token ${address}.`, {
      cause: shortError(error),
    });
  }
  let symbol: string | null = null;
  try {
    symbol = await token.symbol();
  } catch {
    symbol = null;
  }
  return { address, symbol, decimals };
}

/** Latest block timestamp plus a relative window, used as a tx deadline. */
export async function deadlineFromLatest(sdk: Sdk, seconds: number): Promise<bigint> {
  const block = await sdk.publicClient.getBlock({ blockTag: "latest" });
  return block.timestamp + BigInt(seconds);
}

export interface PoolState {
  address: Address;
  token0: Address;
  token1: Address;
  fee: number;
  tickSpacing: number;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

/** Resolve a canonical pool and verify its on-chain token0/token1/fee match. */
export async function getPoolState(sdk: Sdk, tokenA: Address, tokenB: Address, fee: number): Promise<PoolState> {
  const address = await sdk.dex.getPool(tokenA, tokenB, fee);
  if (address === zeroAddress) {
    throw new CliError("POOL_NOT_FOUND", `No canonical pool exists for ${tokenA} / ${tokenB} at fee ${fee}.`);
  }
  const pool = sdk.dex.pool(address);
  const [token0, token1, poolFee, tickSpacing, slot0, liquidity] = await Promise.all([
    pool.token0(),
    pool.token1(),
    pool.fee(),
    pool.tickSpacing(),
    pool.slot0(),
    pool.liquidity(),
  ]);
  const expected = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort();
  const actual = [token0.toLowerCase(), token1.toLowerCase()].sort();
  if (actual[0] !== expected[0] || actual[1] !== expected[1] || poolFee !== fee) {
    throw new CliError(
      "POOL_MISMATCH",
      `Pool ${address} returned token0=${token0}, token1=${token1}, fee=${poolFee}; expected the requested pair and fee.`,
    );
  }
  return {
    address,
    token0,
    token1,
    fee: poolFee,
    tickSpacing,
    sqrtPriceX96: slot0.sqrtPriceX96,
    tick: slot0.tick,
    liquidity,
  };
}

export function addressListEquals(left: readonly Address[], right: readonly Address[]): boolean {
  const a = left.map((item) => item.toLowerCase()).sort();
  const b = right.map((item) => item.toLowerCase()).sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function missingAddresses(left: readonly Address[], right: readonly Address[]): Address[] {
  const allowed = new Set(right.map((item) => item.toLowerCase()));
  return left.filter((item) => !allowed.has(item.toLowerCase()));
}
