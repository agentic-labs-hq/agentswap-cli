import { zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { BawClient } from "../src/baw.js";
import { runSwap } from "../src/core/swap.js";
import { loadDeployment } from "../src/deployment.js";
import type { Runtime } from "../src/runtime.js";
import { connectedBawHandler, fakeBaw, ok } from "./helpers/fake-baw.js";

const TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const POOL = "0x5555555555555555555555555555555555555555" as Address;

function fakeRuntime(onPreview?: (args: string[]) => Record<string, unknown>) {
  const deployment = loadDeployment();
  const wbnb = deployment.wbnb;
  const [token0, token1] = TOKEN.toLowerCase() < wbnb.toLowerCase() ? [TOKEN, wbnb] : [wbnb, TOKEN];
  const sdk = {
    tokens: {
      at: (address: Address) => ({
        decimals: async () => 18,
        symbol: async () => (address === TOKEN ? "TOKEN" : address === wbnb ? "WBNB" : "T"),
        allowance: async () => 10n ** 30n,
      }),
    },
    dex: {
      getPool: async () => POOL,
      pool: () => ({
        token0: async () => token0,
        token1: async () => token1,
        fee: async () => 3000,
        tickSpacing: async () => 60,
        slot0: async () => ({ sqrtPriceX96: 2n ** 96n, tick: 0 }),
        liquidity: async () => 10n ** 18n,
      }),
      positionManager: () => ({
        policyOfToken: async () => zeroAddress,
        isAllowedRecipient: async () => true,
      }),
      quoter: () => ({
        quoteExactInputSingle: async () => 2n * 10n ** 18n,
      }),
    },
    registries: {
      assetRegistry: () => ({ isRegistered: async () => false }),
    },
    publicClient: {
      getBlock: async () => ({ timestamp: 1_700_000_000n }),
    },
  };
  const base = connectedBawHandler({ onPreview: onPreview ?? (() => previewOk()) });
  const fake = fakeBaw(base);
  return {
    runtime: {
      sdk,
      deployment,
      rpcUrl: "http://127.0.0.1:8545",
      rpcHost: "127.0.0.1:8545",
      baw: new BawClient(fake.runner),
    } as unknown as Runtime,
    calls: fake.calls,
    deployment,
  };
}

function previewOk(requestId = "req-swap"): Record<string, unknown> {
  return ok({
    requestId,
    parsedTx: { transactionType: "Send" },
    simulationResult: { simulationCode: "000000000", simulationErrorDetail: null, balanceChanges: [] },
    risks: { riskDetails: [] },
    tokenInfos: {},
    requireConfirmation: false,
    expiresAt: 1_800_000_000_000,
  });
}

describe("runSwap native-out", () => {
  it("builds a multicall with tokenOut=WBNB, router recipient, and value 0", async () => {
    const { runtime, calls, deployment } = fakeRuntime();
    const result = await runSwap(runtime, {
      tokenIn: TOKEN,
      tokenOut: "BNB",
      fee: "3000",
      amountIn: "1",
      minOut: "0.5",
      nativeOut: true,
    });
    const swap = result.swap as Record<string, unknown>;
    const call = result.call as Record<string, unknown>;
    expect(swap.nativeOut).toBe(true);
    expect(swap.tokenOutResolved).toBe(deployment.wbnb);
    expect(swap.tokenOutSymbol).toBe("BNB");
    expect(swap.valueWei).toBe("0");
    expect(call.functionName).toBe("multicall");
    expect((result.preview as Record<string, unknown>).requestId).toBe("req-swap");
    expect(String(result.warnings)).toContain("native balance increase");

    const previewCallArgs = calls.find((args) => args[0] === "contract-call" && args[1] === "preview");
    expect(previewCallArgs).toBeDefined();
    expect(previewCallArgs).toContain("--value");
    expect(previewCallArgs![previewCallArgs!.indexOf("--value") + 1]).toBe("0");
    expect(previewCallArgs![previewCallArgs!.indexOf("--inputData") + 1]).toBe(call.inputData);
    expect(previewCallArgs![previewCallArgs!.indexOf("--to") + 1]).toBe(deployment.addresses.swapRouter);
  });

  it("rejects BNB -> BNB", async () => {
    const { runtime, calls } = fakeRuntime();
    await expect(
      runSwap(runtime, {
        tokenIn: "BNB",
        tokenOut: "BNB",
        fee: "3000",
        amountIn: "1",
        minOut: "0.5",
        nativeOut: true,
      }),
    ).rejects.toMatchObject({ code: "NATIVE_TO_NATIVE_UNSUPPORTED" });
    expect(calls.some((args) => args[0] === "contract-call" && args[1] === "preview")).toBe(false);
  });

  it("rejects --native-out with a non-native tokenOut", async () => {
    const { runtime, calls } = fakeRuntime();
    await expect(
      runSwap(runtime, {
        tokenIn: TOKEN,
        tokenOut: TOKEN,
        fee: "3000",
        amountIn: "1",
        minOut: "0.5",
        nativeOut: true,
      }),
    ).rejects.toMatchObject({ code: "NATIVE_OUT_MISMATCH" });
    expect(calls.some((args) => args[0] === "contract-call" && args[1] === "preview")).toBe(false);
  });

  it("requires --native-out for a native tokenOut", async () => {
    const { runtime } = fakeRuntime();
    await expect(
      runSwap(runtime, {
        tokenIn: TOKEN,
        tokenOut: "BNB",
        fee: "3000",
        amountIn: "1",
        minOut: "0.5",
      }),
    ).rejects.toMatchObject({ code: "NATIVE_OUT_REQUIRED" });
  });

  it("keeps normal WBNB output without --native-out", async () => {
    const { runtime, deployment } = fakeRuntime();
    const result = await runSwap(runtime, {
      tokenIn: TOKEN,
      tokenOut: deployment.wbnb,
      fee: "3000",
      amountIn: "1",
      minOut: "0.5",
    });
    expect((result.call as Record<string, unknown>).functionName).toBe("exactInputSingle");
    expect((result.swap as Record<string, unknown>).nativeOut).toBe(false);
    expect((result.swap as Record<string, unknown>).tokenOutResolved).toBe(deployment.wbnb);
  });

  it("keeps native input value for a normal ERC-20 output", async () => {
    const { runtime, calls } = fakeRuntime();
    const result = await runSwap(runtime, {
      tokenIn: "BNB",
      tokenOut: TOKEN,
      fee: "3000",
      amountIn: "1",
      minOut: "0.5",
    });
    const swap = result.swap as Record<string, unknown>;
    expect(swap.nativeIn).toBe(true);
    expect(swap.valueWei).toBe("1000000000000000000");
    expect((result.call as Record<string, unknown>).valueWei).toBe("1000000000000000000");
    const previewCallArgs = calls.find((args) => args[0] === "contract-call" && args[1] === "preview");
    expect(previewCallArgs![previewCallArgs!.indexOf("--value") + 1]).toBe("1000000000000000000");
  });
});
