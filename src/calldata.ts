import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";

import { poolFactoryAbi, positionManagerAbi, swapRouterAbi, tokenFactoryAbi } from "./abis.js";

/** A prepared external-sign call. No signer is involved. */
export interface PreparedCall {
  action: string;
  to: Address;
  value: bigint;
  inputData: Hex;
  functionName: string;
}

export interface TokenCreateCallParams {
  factory: Address;
  name: string;
  symbol: string;
  policy: Address;
  recipients: readonly Address[];
  amounts: readonly bigint[];
  metadataURI: string;
}

export function buildTokenCreateCall(params: TokenCreateCallParams): PreparedCall {
  return {
    action: "token create",
    to: params.factory,
    value: 0n,
    inputData: encodeFunctionData({
      abi: tokenFactoryAbi,
      functionName: "createToken",
      args: [
        params.name,
        params.symbol,
        params.policy,
        [...params.recipients],
        [...params.amounts],
        params.metadataURI,
      ],
    }),
    functionName: "createToken",
  };
}

export function buildErc20ApproveCall(token: Address, spender: Address, amount: bigint): PreparedCall {
  return {
    action: "approve",
    to: token,
    value: 0n,
    inputData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
    functionName: "approve",
  };
}

export interface PoolCreateCallParams {
  factory: Address;
  tokenA: Address;
  tokenB: Address;
  fee: number;
  sqrtPriceX96: bigint;
}

export function buildPoolCreateCall(params: PoolCreateCallParams): PreparedCall {
  return {
    action: "dex pool create",
    to: params.factory,
    value: 0n,
    inputData: encodeFunctionData({
      abi: poolFactoryAbi,
      functionName: "createPool",
      args: [params.tokenA, params.tokenB, params.fee, params.sqrtPriceX96],
    }),
    functionName: "createPool",
  };
}

export interface LpMintCallParams {
  positionManager: Address;
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: Address;
  deadline: bigint;
}

export function buildLpMintCall(params: LpMintCallParams): PreparedCall {
  return {
    action: "dex lp add",
    to: params.positionManager,
    value: 0n,
    inputData: encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "mint",
      args: [
        {
          token0: params.token0,
          token1: params.token1,
          fee: params.fee,
          tickLower: params.tickLower,
          tickUpper: params.tickUpper,
          amount0Desired: params.amount0Desired,
          amount1Desired: params.amount1Desired,
          amount0Min: params.amount0Min,
          amount1Min: params.amount1Min,
          recipient: params.recipient,
          deadline: params.deadline,
        },
      ],
    }),
    functionName: "mint",
  };
}

export interface SwapCallParams {
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  recipient: Address;
  deadline: bigint;
  amountIn: bigint;
  amountOutMinimum: bigint;
  /** Native BNB input only; zero for ERC-20 input. */
  value?: bigint;
}

export function buildSwapCall(params: SwapCallParams): PreparedCall {
  return {
    action: "dex swap",
    to: params.router,
    value: params.value ?? 0n,
    inputData: encodeFunctionData({
      abi: swapRouterAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          fee: params.fee,
          recipient: params.recipient,
          deadline: params.deadline,
          amountIn: params.amountIn,
          amountOutMinimum: params.amountOutMinimum,
          sqrtPriceLimitX96: 0n,
        },
      ],
    }),
    functionName: "exactInputSingle",
  };
}

/** Exact-input swap that unwraps the WBNB output to native BNB in one router multicall. */
export function buildNativeOutSwapCall(params: SwapCallParams): PreparedCall {
  const exactInput = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: params.fee,
        // The router must receive WBNB so it can unwrap it in the second call.
        recipient: params.router,
        deadline: params.deadline,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const unwrap = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: "unwrapWETH9",
    args: [params.amountOutMinimum, params.recipient],
  });
  return {
    action: "dex swap",
    to: params.router,
    // ERC-20 input only; multicall is payable but no native value is sent.
    value: 0n,
    inputData: encodeFunctionData({
      abi: swapRouterAbi,
      functionName: "multicall",
      args: [[exactInput, unwrap]],
    }),
    functionName: "multicall",
  };
}

export interface LpDecreaseCallParams {
  positionManager: Address;
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: bigint;
}

export function buildLpDecreaseCall(params: LpDecreaseCallParams): PreparedCall {
  return {
    action: "dex lp remove (decrease)",
    to: params.positionManager,
    value: 0n,
    inputData: encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId: params.tokenId,
          liquidity: params.liquidity,
          amount0Min: params.amount0Min,
          amount1Min: params.amount1Min,
          deadline: params.deadline,
        },
      ],
    }),
    functionName: "decreaseLiquidity",
  };
}

export interface LpCollectCallParams {
  positionManager: Address;
  tokenId: bigint;
  recipient: Address;
  amount0Max: bigint;
  amount1Max: bigint;
}

export function buildLpCollectCall(params: LpCollectCallParams): PreparedCall {
  return {
    action: "dex lp remove (collect)",
    to: params.positionManager,
    value: 0n,
    inputData: encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId: params.tokenId,
          recipient: params.recipient,
          amount0Max: params.amount0Max,
          amount1Max: params.amount1Max,
        },
      ],
    }),
    functionName: "collect",
  };
}

export function buildLpBurnCall(positionManager: Address, tokenId: bigint): PreparedCall {
  return {
    action: "dex lp remove (burn)",
    to: positionManager,
    value: 0n,
    inputData: encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "burn",
      args: [tokenId],
    }),
    functionName: "burn",
  };
}

/** uint128 maximum, used for collect(amount0Max, amount1Max). */
export const MAX_UINT128 = 340282366920938463463374607431768211455n;

/** First 4-byte selector for human display; never used as an input. */
export function selectorOf(inputData: Hex): string {
  return inputData.length >= 10 ? inputData.slice(0, 10) : inputData;
}
