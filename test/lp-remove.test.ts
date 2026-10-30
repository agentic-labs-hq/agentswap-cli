import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import { BawClient } from "../src/baw.js";
import { runLpRemove } from "../src/core/lp-remove.js";
import { loadDeployment } from "../src/deployment.js";
import type { Runtime } from "../src/runtime.js";
import { BSC_ADDRESS, connectedBawHandler, fail, fakeBaw, ok } from "./helpers/fake-baw.js";

const TOKEN0 = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN1 = "0x3333333333333333333333333333333333333333" as Address;
const OTHER = "0x4444444444444444444444444444444444444444";

function position(overrides: Record<string, unknown> = {}) {
  return {
    nonce: 0n,
    operator: "0x0000000000000000000000000000000000000000",
    token0: TOKEN0,
    token1: TOKEN1,
    fee: 3000,
    tickLower: -887220,
    tickUpper: 887220,
    liquidity: 1000n,
    feeGrowthInside0LastX128: 0n,
    feeGrowthInside1LastX128: 0n,
    tokensOwed0: 5n,
    tokensOwed1: 6n,
    ...overrides,
  };
}

function fakeRuntime(
  handler: (args: string[]) => unknown,
  overrides: { position?: Record<string, unknown>; owner?: string } = {},
): { runtime: Runtime; calls: string[][] } {
  const deployment = loadDeployment();
  const positionValue = position(overrides.position);
  const sdk = {
    dex: {
      positionManager: () => ({
        positions: async () => positionValue,
        ownerOf: async () => (overrides.owner ?? BSC_ADDRESS) as Address,
      }),
    },
    tokens: {
      at: (address: Address) => ({
        decimals: async () => 18,
        symbol: async () => (address === TOKEN0 ? "T0" : "T1"),
      }),
    },
    publicClient: {
      getBlock: async () => ({ timestamp: 1_700_000_000n }),
    },
  };
  const fake = fakeBaw(handler as never);
  return {
    runtime: {
      sdk,
      deployment,
      rpcUrl: "http://127.0.0.1:8545",
      rpcHost: "127.0.0.1:8545",
      baw: new BawClient(fake.runner),
    } as unknown as Runtime,
    calls: fake.calls,
  };
}

function previewHandler(options: { failBurn?: boolean; failCollect?: boolean } = {}) {
  let previewCount = 0;
  const base = connectedBawHandler();
  return (args: string[]) => {
    if (args[0] === "contract-call" && args[1] === "preview") {
      previewCount += 1;
      if (options.failBurn === true && previewCount === 3) {
        return fail({
          code: 351803,
          name: "AGENT_DEV_MODE_RISK_BLOCKED",
          message: "Position liquidity must be zero before burn",
          data: { blockLevel: "Block" },
        });
      }
      if (options.failCollect === true && previewCount === 2) {
        return fail({
          code: 351803,
          name: "AGENT_DEV_MODE_RISK_BLOCKED",
          message: "Collect simulation reverted",
          data: { blockLevel: "Block" },
        });
      }
      return ok({
        requestId: `req-${previewCount}`,
        parsedTx: { transactionType: "Send" },
        simulationResult: { simulationCode: "000000000", simulationErrorDetail: null },
        risks: { riskDetails: [] },
        tokenInfos: {},
        requireConfirmation: false,
        expiresAt: 1_800_000_000_000,
      });
    }
    return base(args);
  };
}

describe("runLpRemove", () => {
  it("rejects an invalid tokenId before calling BAW", async () => {
    const { runtime, calls } = fakeRuntime(previewHandler());
    await expect(runLpRemove(runtime, { tokenId: "abc" })).rejects.toMatchObject({ code: "INVALID_INTEGER" });
    await expect(runLpRemove(runtime, { tokenId: "-1" })).rejects.toMatchObject({ code: "INVALID_INTEGER" });
    expect(calls).toEqual([]);
  });

  it("previews decrease, collect, and burn in order and flags sequential execution", async () => {
    const { runtime, calls } = fakeRuntime(previewHandler());
    const result = await runLpRemove(runtime, { tokenId: "7", minAmount0: "0", minAmount1: "0" });
    const steps = result.orderedSteps as Array<Record<string, unknown>>;
    expect(steps.map((step) => step.kind)).toEqual(["decrease", "collect", "burn"]);
    expect(steps.map((step) => step.requestId)).toEqual(["req-1", "req-2", "req-3"]);
    expect(result.requiresSequentialExecution).toBe(true);
    expect(result.previewOnly).toBe(true);
    expect(result.executed).toBe(false);
    expect((result.liquidity as Record<string, unknown>).selected).toBe("1000");
    expect((result.liquidity as Record<string, unknown>).remaining).toBe("0");
    expect(calls.some((args) => args[0] === "contract-call" && args[1] === "execute")).toBe(false);
  });

  it("returns orderedSteps with an error when burn cannot preview yet", async () => {
    const { runtime } = fakeRuntime(previewHandler({ failBurn: true }));
    const result = await runLpRemove(runtime, { tokenId: "7", minAmount0: "0", minAmount1: "0" });
    const steps = result.orderedSteps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(3);
    expect(steps[0]!.requestId).toBe("req-1");
    expect(steps[1]!.requestId).toBe("req-2");
    expect(steps[2]!.requestId).toBeNull();
    expect(steps[2]!.error).toMatchObject({ code: "BAW_PREVIEW_REJECTED" });
    expect(result.requiresSequentialExecution).toBe(true);
    expect(String((result.next as Record<string, unknown>).note)).toContain("re-run");
    expect(String(result.warnings)).toContain("burn preview was rejected");
  });

  it("supports partial removal with --no-burn and preserves the remaining liquidity", async () => {
    const { runtime } = fakeRuntime(previewHandler());
    const result = await runLpRemove(runtime, { tokenId: "7", liquidity: "50%", noBurn: true, minAmount0: "0", minAmount1: "0" });
    const steps = result.orderedSteps as Array<Record<string, unknown>>;
    expect(steps.map((step) => step.kind)).toEqual(["decrease", "collect"]);
    expect(result.liquidity).toMatchObject({ selected: "500", remaining: "500", mode: "percent" });
    expect(result.requiresSequentialExecution).toBe(true);
  });

  it("skips decrease when liquidity is already zero and can preview collect/burn", async () => {
    const { runtime } = fakeRuntime(previewHandler(), { position: { liquidity: 0n } });
    const result = await runLpRemove(runtime, { tokenId: "7", minAmount0: "0", minAmount1: "0" });
    const steps = result.orderedSteps as Array<Record<string, unknown>>;
    expect(steps.map((step) => step.kind)).toEqual(["collect", "burn"]);
    expect(result.deadline).toBeNull();
  });

  it("allows a single decrease-only step", async () => {
    const { runtime } = fakeRuntime(previewHandler());
    const result = await runLpRemove(runtime, { tokenId: "7", noCollect: true, noBurn: true, minAmount0: "0", minAmount1: "0" });
    const steps = result.orderedSteps as Array<Record<string, unknown>>;
    expect(steps.map((step) => step.kind)).toEqual(["decrease"]);
    expect(result.requiresSequentialExecution).toBe(false);
  });

  it("rejects an owner other than the Agentic Wallet before preview", async () => {
    const { runtime, calls } = fakeRuntime(previewHandler(), { owner: OTHER });
    await expect(runLpRemove(runtime, { tokenId: "7", minAmount0: "0", minAmount1: "0" })).rejects.toMatchObject({ code: "NOT_POSITION_OWNER" });
    expect(calls.some((args) => args[0] === "contract-call")).toBe(false);
  });

  it("rejects partial removal without --no-burn", async () => {
    const { runtime, calls } = fakeRuntime(previewHandler());
    await expect(runLpRemove(runtime, { tokenId: "7", liquidity: "50%" })).rejects.toMatchObject({
      code: "BURN_REQUIRES_FULL_LIQUIDITY",
    });
    expect(calls.some((args) => args[0] === "contract-call")).toBe(false);
  });

  it("requires minima whenever a decrease is planned", async () => {
    const { runtime, calls } = fakeRuntime(previewHandler());
    await expect(runLpRemove(runtime, { tokenId: "7" })).rejects.toMatchObject({ code: "USAGE" });
    expect(calls.some((args) => args[0] === "contract-call")).toBe(false);
  });

  it("passes configured minima into decrease calldata", async () => {
    const { runtime } = fakeRuntime(previewHandler());
    const result = await runLpRemove(runtime, { tokenId: "7", minAmount0: "12", minAmount1: "34" });
    const steps = result.orderedSteps as Array<Record<string, unknown>>;
    expect(result.amount0Min).toBe("12");
    expect(result.amount1Min).toBe("34");
    expect(steps[0]!.call).toMatchObject({ functionName: "decreaseLiquidity" });
  });

  it("rejects --no-collect with burn when tokensOwed or liquidity remain", async () => {
    const { runtime, calls } = fakeRuntime(previewHandler());
    await expect(
      runLpRemove(runtime, { tokenId: "7", noCollect: true, minAmount0: "0", minAmount1: "0" }),
    ).rejects.toMatchObject({ code: "BURN_REQUIRES_COLLECT" });
    expect(calls.some((args) => args[0] === "contract-call")).toBe(false);
  });

  it("supports collect-only recovery without decreasing again", async () => {
    const { runtime } = fakeRuntime(previewHandler());
    const result = await runLpRemove(runtime, { tokenId: "7", collectOnly: true });
    const steps = result.orderedSteps as Array<Record<string, unknown>>;
    expect(steps.map((step) => step.kind)).toEqual(["collect"]);
    expect(result.liquidity).toMatchObject({ selected: "0", remaining: "1000" });
  });
});
