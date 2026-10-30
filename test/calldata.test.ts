import { decodeFunctionData, erc20Abi, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { poolFactoryAbi, positionManagerAbi, swapRouterAbi, tokenFactoryAbi } from "../src/abis.js";
import {
  buildErc20ApproveCall,
  buildLpBurnCall,
  buildLpCollectCall,
  buildLpDecreaseCall,
  buildLpMintCall,
  buildNativeOutSwapCall,
  buildPoolCreateCall,
  buildSwapCall,
  buildTokenCreateCall,
  MAX_UINT128,
  selectorOf,
} from "../src/calldata.js";
import { assertNotNativeToNative, resolveSwapInput, resolveSwapOutput } from "../src/lib/native.js";

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const C = "0x3333333333333333333333333333333333333333" as Address;
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address;
const POLICY = "0xdb7FA5F2DDEaCF0Dbd7cd8ACa12A43A1050D4Ff7" as Address;

describe("token create calldata", () => {
  it("encodes createToken with recipients, amounts, and metadata", () => {
    const call = buildTokenCreateCall({
      factory: A,
      name: "Example Agent",
      symbol: "EGT",
      policy: POLICY,
      recipients: [B, C],
      amounts: [60n, 40n],
      metadataURI: "ipfs://example",
    });
    expect(call.to).toBe(A);
    expect(call.value).toBe(0n);
    expect(call.functionName).toBe("createToken");
    expect(selectorOf(call.inputData)).toHaveLength(10);
    const decoded = decodeFunctionData({ abi: tokenFactoryAbi, data: call.inputData });
    expect(decoded.functionName).toBe("createToken");
    expect(decoded.args).toEqual(["Example Agent", "EGT", POLICY, [B, C], [60n, 40n], "ipfs://example"]);
  });
});

describe("approve calldata", () => {
  it("encodes exact approve and revoke", () => {
    const approve = buildErc20ApproveCall(A, B, 123n);
    expect(approve.to).toBe(A);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: approve.inputData });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args).toEqual([B, 123n]);

    const revoke = buildErc20ApproveCall(A, B, 0n);
    const decodedRevoke = decodeFunctionData({ abi: erc20Abi, data: revoke.inputData });
    expect(decodedRevoke.args).toEqual([B, 0n]);
  });
});

describe("pool create calldata", () => {
  it("encodes createPool with uint160 sqrt price", () => {
    const sqrt = 2n ** 96n;
    const call = buildPoolCreateCall({ factory: A, tokenA: B, tokenB: C, fee: 3000, sqrtPriceX96: sqrt });
    expect(call.to).toBe(A);
    const decoded = decodeFunctionData({ abi: poolFactoryAbi, data: call.inputData });
    expect(decoded.functionName).toBe("createPool");
    expect(decoded.args).toEqual([B, C, 3000, sqrt]);
  });
});

describe("LP mint calldata", () => {
  it("encodes the NPM mint tuple", () => {
    const call = buildLpMintCall({
      positionManager: A,
      token0: B,
      token1: C,
      fee: 3000,
      tickLower: -887220,
      tickUpper: 887220,
      amount0Desired: 100n,
      amount1Desired: 200n,
      amount0Min: 99n,
      amount1Min: 198n,
      recipient: B,
      deadline: 1_800_000_000n,
    });
    expect(call.to).toBe(A);
    const decoded = decodeFunctionData({ abi: positionManagerAbi, data: call.inputData });
    expect(decoded.functionName).toBe("mint");
    const params = decoded.args[0] as unknown as Record<string, unknown>;
    expect(params).toMatchObject({
      token0: B,
      token1: C,
      fee: 3000,
      tickLower: -887220,
      tickUpper: 887220,
      amount0Desired: 100n,
      amount1Desired: 200n,
      amount0Min: 99n,
      amount1Min: 198n,
      recipient: B,
      deadline: 1_800_000_000n,
    });
  });
});

describe("swap calldata", () => {
  it("encodes exactInputSingle and native value", () => {
    const call = buildSwapCall({
      router: A,
      tokenIn: WBNB,
      tokenOut: C,
      fee: 3000,
      recipient: B,
      deadline: 1_800_000_000n,
      amountIn: 10n ** 18n,
      amountOutMinimum: 5n,
      value: 10n ** 18n,
    });
    expect(call.to).toBe(A);
    expect(call.value).toBe(10n ** 18n);
    const decoded = decodeFunctionData({ abi: swapRouterAbi, data: call.inputData });
    expect(decoded.functionName).toBe("exactInputSingle");
    expect(decoded.args[0]).toMatchObject({
      tokenIn: WBNB,
      tokenOut: C,
      fee: 3000,
      recipient: B,
      deadline: 1_800_000_000n,
      amountIn: 10n ** 18n,
      amountOutMinimum: 5n,
      sqrtPriceLimitX96: 0n,
    });
  });
});

describe("native-out swap calldata", () => {
  it("encodes a multicall with router-recipient exactInputSingle then unwrapWETH9", () => {
    const call = buildNativeOutSwapCall({
      router: A,
      tokenIn: B,
      tokenOut: WBNB,
      fee: 3000,
      recipient: C,
      deadline: 1_800_000_000n,
      amountIn: 10n ** 18n,
      amountOutMinimum: 5n,
    });
    expect(call.to).toBe(A);
    expect(call.value).toBe(0n);
    expect(call.functionName).toBe("multicall");

    const outer = decodeFunctionData({ abi: swapRouterAbi, data: call.inputData });
    expect(outer.functionName).toBe("multicall");
    const inner = outer.args[0] as `0x${string}`[];
    expect(inner).toHaveLength(2);

    const swap = decodeFunctionData({ abi: swapRouterAbi, data: inner[0]! });
    expect(swap.functionName).toBe("exactInputSingle");
    expect(swap.args[0]).toMatchObject({
      tokenIn: B,
      tokenOut: WBNB,
      fee: 3000,
      recipient: A,
      deadline: 1_800_000_000n,
      amountIn: 10n ** 18n,
      amountOutMinimum: 5n,
      sqrtPriceLimitX96: 0n,
    });

    const unwrap = decodeFunctionData({ abi: swapRouterAbi, data: inner[1]! });
    expect(unwrap.functionName).toBe("unwrapWETH9");
    expect(unwrap.args).toEqual([5n, C]);
  });
});

describe("LP remove calldata", () => {
  it("encodes decreaseLiquidity with zero mins and a deadline", () => {
    const call = buildLpDecreaseCall({
      positionManager: A,
      tokenId: 7n,
      liquidity: 123n,
      amount0Min: 0n,
      amount1Min: 0n,
      deadline: 1_800_000_000n,
    });
    expect(call.to).toBe(A);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: positionManagerAbi, data: call.inputData });
    expect(decoded.functionName).toBe("decreaseLiquidity");
    expect(decoded.args[0]).toMatchObject({
      tokenId: 7n,
      liquidity: 123n,
      amount0Min: 0n,
      amount1Min: 0n,
      deadline: 1_800_000_000n,
    });
  });

  it("encodes collect with uint128 max amounts and AW recipient", () => {
    const call = buildLpCollectCall({
      positionManager: A,
      tokenId: 7n,
      recipient: B,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    });
    const decoded = decodeFunctionData({ abi: positionManagerAbi, data: call.inputData });
    expect(decoded.functionName).toBe("collect");
    expect(decoded.args[0]).toMatchObject({
      tokenId: 7n,
      recipient: B,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    });
  });

  it("encodes burn(tokenId)", () => {
    const call = buildLpBurnCall(A, 7n);
    const decoded = decodeFunctionData({ abi: positionManagerAbi, data: call.inputData });
    expect(decoded.functionName).toBe("burn");
    expect(decoded.args).toEqual([7n]);
  });
});

describe("native BNB resolution", () => {
  it("accepts aliases and the Binance native sentinel", () => {
    for (const value of ["BNB", "bnb", "native", "eth", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"]) {
      const resolved = resolveSwapInput(value, WBNB);
      expect(resolved.isNative).toBe(true);
      expect(resolved.token).toBe(WBNB);
    }
  });

  it("treats a normal address as ERC-20", () => {
    const resolved = resolveSwapInput(B, WBNB);
    expect(resolved.isNative).toBe(false);
    expect(resolved.token).toBe(B);
  });

  it("requires --native-out exactly when tokenOut is native", () => {
    expect(resolveSwapOutput("BNB", true, WBNB)).toEqual({ token: WBNB, isNative: true });
    expect(resolveSwapOutput(B, false, WBNB)).toEqual({ token: B, isNative: false });
    expect(() => resolveSwapOutput(B, true, WBNB)).toThrowError(
      expect.objectContaining({ code: "NATIVE_OUT_MISMATCH" }),
    );
    expect(() => resolveSwapOutput("BNB", false, WBNB)).toThrowError(
      expect.objectContaining({ code: "NATIVE_OUT_REQUIRED" }),
    );
    expect(() => assertNotNativeToNative(true, true)).toThrowError(
      expect.objectContaining({ code: "NATIVE_TO_NATIVE_UNSUPPORTED" }),
    );
    expect(() => assertNotNativeToNative(true, false)).not.toThrow();
  });
});
