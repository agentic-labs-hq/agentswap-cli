import type { Address } from "viem";

import { positionManagerAbi } from "../abis.js";
import { CliError } from "../errors.js";
import { parseAddress } from "../lib/parse.js";
import type { Runtime } from "../runtime.js";
import { loadWalletForRead } from "../wallet.js";
import {
  baseResult,
  erc20Meta,
  getPoolState,
  shortError,
  type CommandResult,
  type Erc20Meta,
  type PoolState,
} from "./common.js";

export interface PositionsOptions {
  owner?: string;
}

const MAX_POSITIONS = 200;

/**
 * Enumerate position-manager positions. The owner defaults to the Binance Agentic Wallet BSC
 * address; `--owner` can be used without BAW. Read-only.
 */
export async function runPositions(runtime: Runtime, options: PositionsOptions): Promise<CommandResult> {
  const { sdk, deployment } = runtime;
  let owner: Address;
  let walletReport: Record<string, unknown> | null = null;

  if (options.owner !== undefined) {
    owner = parseAddress(options.owner, "--owner");
  } else {
    const wallet = await loadWalletForRead(runtime.baw);
    owner = wallet.address;
    walletReport = {
      address: wallet.address,
      status: wallet.status,
      source: "binance-agentic-wallet",
    };
  }

  const npm = deployment.addresses.positionManager!;
  const npmActions = sdk.dex.positionManager();
  const balance = await npmActions.balanceOf(owner);
  if (balance > BigInt(MAX_POSITIONS)) {
    throw new CliError(
      "TOO_MANY_POSITIONS",
      `Owner ${owner} has ${balance} positions; refusing to enumerate more than ${MAX_POSITIONS} in one call.`,
    );
  }

  const tokenIds = await Promise.all(
    Array.from({ length: Number(balance) }, async (_, index) => {
      const tokenId = await sdk.publicClient.readContract({
        address: npm,
        abi: positionManagerAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [owner, BigInt(index)],
      });
      return tokenId as bigint;
    }),
  );
  tokenIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const warnings: string[] = [];
  const metaCache = new Map<string, Erc20Meta | null>();
  const poolCache = new Map<string, PoolState | null>();

  const metaFor = async (token: Address): Promise<Erc20Meta | null> => {
    const key = token.toLowerCase();
    if (metaCache.has(key)) return metaCache.get(key)!;
    try {
      const meta = await erc20Meta(sdk, token);
      metaCache.set(key, meta);
      return meta;
    } catch (error) {
      metaCache.set(key, null);
      warnings.push(`Could not read metadata for token ${token}: ${shortError(error)}`);
      return null;
    }
  };

  const poolFor = async (token0: Address, token1: Address, fee: number): Promise<PoolState | null> => {
    const key = `${token0.toLowerCase()}-${token1.toLowerCase()}-${fee}`;
    if (poolCache.has(key)) return poolCache.get(key)!;
    try {
      const state = await getPoolState(sdk, token0, token1, fee);
      poolCache.set(key, state);
      return state;
    } catch (error) {
      poolCache.set(key, null);
      warnings.push(`Could not read pool for ${token0}/${token1} fee ${fee}: ${shortError(error)}`);
      return null;
    }
  };

  const positions = await Promise.all(
    tokenIds.map(async (tokenId) => {
      const position = await npmActions.positions(tokenId);
      const [meta0, meta1, pool] = await Promise.all([
        metaFor(position.token0),
        metaFor(position.token1),
        poolFor(position.token0, position.token1, position.fee),
      ]);
      return {
        tokenId: tokenId.toString(),
        token0: position.token0,
        token0Symbol: meta0?.symbol ?? null,
        token0Decimals: meta0?.decimals ?? null,
        token1: position.token1,
        token1Symbol: meta1?.symbol ?? null,
        token1Decimals: meta1?.decimals ?? null,
        fee: position.fee,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: position.liquidity.toString(),
        tokensOwed0: position.tokensOwed0.toString(),
        tokensOwed1: position.tokensOwed1.toString(),
        pool: pool?.address ?? null,
        currentTick: pool?.tick ?? null,
        inRange: pool === null ? null : position.tickLower <= pool.tick && pool.tick < position.tickUpper,
      };
    }),
  );

  const blockNumber = await sdk.publicClient.getBlockNumber({ cacheTime: 0 });

  return {
    ...baseResult(runtime, "dex positions"),
    blockNumber: blockNumber.toString(),
    owner,
    ownerSource: options.owner === undefined ? "binance-agentic-wallet" : "flag",
    wallet: walletReport,
    positionManager: npm,
    count: positions.length,
    positions,
    warnings: [...new Set(warnings)],
  };
}
