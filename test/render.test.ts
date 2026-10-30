import { describe, expect, it } from "vitest";

import { CliError, errorPayload } from "../src/errors.js";
import { renderErrorHuman, renderHuman } from "../src/render.js";

describe("human rendering", () => {
  it("renders preview fields and the next execute command", () => {
    const text = renderHuman({
      ok: true,
      command: "token approve",
      chainId: 56,
      network: "bsc-mainnet",
      previewOnly: true,
      wallet: { address: "0x1111111111111111111111111111111111111111", status: "CONNECTED", devMode: true },
      approval: {
        token: "0x2222222222222222222222222222222222222222",
        symbol: "USDT",
        spender: "0x3333333333333333333333333333333333333333",
        amount: "1000000",
        amountHuman: "1",
        currentAllowanceHuman: "0",
        isRevoke: false,
      },
      call: {
        functionName: "approve",
        to: "0x2222222222222222222222222222222222222222",
        valueWei: "0",
        inputData: "0x095ea7b3",
      },
      preview: {
        requestId: "req-1",
        parsedTx: { transactionType: "Send" },
        simulationResult: { simulationCode: "000000000", simulationErrorDetail: null },
        risks: { riskDetails: [] },
        requireConfirmation: false,
        expiresAt: 1_800_000_000_000,
        nextCommand: "agentswap tx execute --request-id req-1 --confirm",
      },
      warnings: [],
    });
    expect(text).toContain("PREVIEW ONLY");
    expect(text).toContain("Request ID: req-1");
    expect(text).toContain("agentswap tx execute --request-id req-1 --confirm");
    expect(text).toContain("Developer Mode: enabled");
  });

  it("renders needsApproval steps", () => {
    const text = renderHuman({
      ok: true,
      command: "dex swap",
      status: "needsApproval",
      wallet: { address: "0x1111111111111111111111111111111111111111", status: "CONNECTED", devMode: true },
      swap: {
        tokenIn: "0x1111111111111111111111111111111111111111",
        tokenInSymbol: "T",
        tokenOut: "0x2222222222222222222222222222222222222222",
        tokenOutSymbol: "U",
        fee: 3000,
        pool: "0x3333333333333333333333333333333333333333",
        amountInHuman: "1",
        amountIn: "1",
        amountOutMinimumHuman: "0.5",
        quotedAmountOutHuman: "0.6",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: null,
        valueWei: "0",
        nativeIn: false,
      },
      allowances: [],
      needsApproval: [
        {
          kind: "approve",
          token: "0x1111111111111111111111111111111111111111",
          symbol: "T",
          spender: "0x4444444444444444444444444444444444444444",
          amount: "1",
          amountHuman: "1",
          resetFirst: false,
          reason: "exact allowance",
          preview: { requestId: "req-a", requireConfirmation: false },
          nextCommand: "agentswap tx execute --request-id req-a --confirm",
        },
      ],
      next: { note: "execute then re-run" },
      warnings: [],
    });
    expect(text).toContain("Needs approval first");
    expect(text).toContain("req-a");
  });

  it("renders LP removal steps and native-out swap details", () => {
    const removal = renderHuman({
      ok: true,
      command: "dex lp remove",
      previewOnly: true,
      requiresSequentialExecution: true,
      wallet: { address: "0x1111111111111111111111111111111111111111", status: "CONNECTED", devMode: true },
      position: {
        tokenId: "7",
        token0Symbol: "T0",
        token1Symbol: "T1",
        fee: 3000,
        tickLower: -60,
        tickUpper: 60,
        owner: "0x1111111111111111111111111111111111111111",
        currentLiquidity: "1000",
      },
      liquidity: { selected: "1000", mode: "full", remaining: "0" },
      collect: true,
      burn: true,
      orderedSteps: [
        {
          index: 1,
          kind: "decrease",
          description: "decrease",
          call: { functionName: "decreaseLiquidity", to: "0x2222222222222222222222222222222222222222" },
          requestId: "req-dec",
          preview: { requireConfirmation: false },
          nextCommand: "agentswap tx execute --request-id req-dec --confirm",
          error: null,
        },
        {
          index: 3,
          kind: "burn",
          description: "burn",
          call: { functionName: "burn", to: "0x2222222222222222222222222222222222222222" },
          requestId: null,
          preview: null,
          nextCommand: null,
          error: { code: "BAW_PREVIEW_REJECTED", message: "position still has liquidity" },
        },
      ],
      next: { note: "execute then re-run" },
      warnings: [],
    });
    expect(removal).toContain("requiresSequentialExecution: true");
    expect(removal).toContain("requestId=req-dec");
    expect(removal).toContain("position still has liquidity");

    const swap = renderHuman({
      ok: true,
      command: "dex swap",
      status: "previewed",
      wallet: { address: "0x1111111111111111111111111111111111111111", status: "CONNECTED", devMode: true },
      swap: {
        tokenInSymbol: "T",
        tokenOutSymbol: "BNB",
        tokenOutResolved: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        nativeOut: true,
        nativeIn: false,
        fee: 3000,
        pool: "0x3333333333333333333333333333333333333333",
        amountInHuman: "1",
        amountIn: "1000000000000000000",
        valueWei: "0",
        amountOutMinimumHuman: "0.5",
        quotedAmountOutHuman: "0.6",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: "1800000000",
      },
      needsApproval: [],
      call: { functionName: "multicall", to: "0x4444444444444444444444444444444444444444", valueWei: "0" },
      preview: {
        requestId: "req-swap",
        parsedTx: {},
        simulationResult: {},
        risks: { riskDetails: [] },
        requireConfirmation: false,
        expiresAt: null,
        nextCommand: "agentswap tx execute --request-id req-swap --confirm",
      },
      warnings: [],
    });
    expect(swap).toContain("native BNB output via multicall");
    expect(swap).toContain("Resolved tokenOut");
  });

  it("includes BAW risks in human error output", () => {
    const payload = errorPayload(
      new CliError("BAW_PREVIEW_REJECTED", "High risk transaction", {
        bawError: {
          name: "AGENT_DEV_MODE_RISK_BLOCKED",
          data: {
            risks: {
              riskDetails: [{ riskType: "RISK", title: "High Risk Address", description: "Flagged target" }],
            },
          },
        },
      }),
      "token create",
    );
    const text = renderErrorHuman(payload);
    expect(text).toContain("High risk transaction");
    expect(text).toContain("High Risk Address");
    expect(text).toContain("Flagged target");
  });
});
