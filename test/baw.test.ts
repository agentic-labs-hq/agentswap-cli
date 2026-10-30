import { describe, expect, it } from "vitest";

import { BawClient, BawCommandError, versionAtLeast } from "../src/baw.js";
import { CliError } from "../src/errors.js";
import { previewCall, previewWarnings } from "../src/preview.js";
import type { PreparedCall } from "../src/calldata.js";
import { BSC_ADDRESS, fail, fakeBaw, ok } from "./helpers/fake-baw.js";

const TARGET = "0x3333333333333333333333333333333333333333";
const CALL: PreparedCall = {
  action: "token approve",
  to: TARGET,
  value: 0n,
  inputData: "0x095ea7b3",
  functionName: "approve",
};

function previewEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return ok({
    requestId: "req-1",
    parsedTx: { transactionType: "Send" },
    simulationResult: { simulationCode: "000000000", simulationErrorDetail: null },
    risks: { riskDetails: [] },
    tokenInfos: {},
    requireConfirmation: false,
    expiresAt: 1_800_000_000_000,
    ...overrides,
  });
}

describe("BawClient commands", () => {
  it("calls wallet status/address/settings/tx-lock with --json", async () => {
    const fake = fakeBaw((args) => {
      if (args[1] === "status") return ok({ status: "CONNECTED" });
      if (args[1] === "address") return ok({ addresses: [{ binanceChainId: "56", address: BSC_ADDRESS }] });
      if (args[1] === "settings") return ok({ devMode: { enabled: true } });
      if (args[1] === "tx-lock") return ok({ status: "UNLOCKED" });
      throw new Error("unexpected");
    });
    const client = new BawClient(fake.runner);
    await expect(client.walletStatus()).resolves.toEqual({ status: "CONNECTED" });
    await expect(client.walletAddress()).resolves.toEqual({
      addresses: [{ binanceChainId: "56", address: BSC_ADDRESS }],
    });
    await expect(client.walletSettings()).resolves.toEqual({ devMode: { enabled: true } });
    await expect(client.walletTxLock()).resolves.toEqual({ status: "UNLOCKED" });
    expect(fake.calls).toEqual([
      ["wallet", "status", "--json"],
      ["wallet", "address", "--json"],
      ["wallet", "settings", "--json"],
      ["wallet", "tx-lock", "--binanceChainId", "56", "--json"],
    ]);
  });

  it("builds the exact contract-call preview argv", async () => {
    const fake = fakeBaw(() => previewEnvelope());
    const client = new BawClient(fake.runner);
    const result = await client.contractCallPreview({
      from: BSC_ADDRESS,
      to: TARGET,
      value: 0n,
      inputData: "0x095ea7b3",
    });
    expect(result.requestId).toBe("req-1");
    expect(fake.calls[0]).toEqual([
      "contract-call",
      "preview",
      "--binanceChainId",
      "56",
      "--from",
      BSC_ADDRESS,
      "--to",
      TARGET,
      "--value",
      "0",
      "--inputData",
      "0x095ea7b3",
      "--json",
    ]);
  });

  it("builds the exact execute argv", async () => {
    const fake = fakeBaw(() => ok({ orderId: "order-1", status: "BROADCASTED", txHash: `0x${"ab".repeat(32)}` }));
    const client = new BawClient(fake.runner);
    const result = await client.contractCallExecute("req-1");
    expect(result.orderId).toBe("order-1");
    expect(fake.calls[0]).toEqual(["contract-call", "execute", "--requestId", "req-1", "--json"]);
  });

  it("queries tx status by hash through tx-history", async () => {
    const fake = fakeBaw(() => ok({ binanceChainId: "56", txHash: `0x${"ab".repeat(32)}`, status: "SUCCESS" }));
    const client = new BawClient(fake.runner);
    const status = await client.walletTxHistoryByHash(`0x${"ab".repeat(32)}`);
    expect(status?.status).toBe("SUCCESS");
    expect(fake.calls[0]).toEqual([
      "wallet",
      "tx-history",
      "--tx",
      `0x${"ab".repeat(32)}`,
      "--binanceChainId",
      "56",
      "--json",
    ]);
  });

  it("reads the local version without JSON", async () => {
    const fake = fakeBaw(() => "1.12.0\n");
    const client = new BawClient(fake.runner);
    await expect(client.version()).resolves.toBe("1.12.0");
    expect(fake.calls[0]).toEqual(["--version"]);
  });

  it("maps NETWORK_ERROR to BAW_UNAVAILABLE", async () => {
    const fake = fakeBaw(() =>
      fail({ code: 50001001, name: "NETWORK_ERROR", message: "TLS connection failed" }),
    );
    const client = new BawClient(fake.runner);
    await expect(client.walletStatus()).rejects.toMatchObject({
      code: "BAW_UNAVAILABLE",
      message: "TLS connection failed",
    });
  });

  it("rejects invalid JSON without dumping stdout", async () => {
    const fake = fakeBaw(() => "not json");
    const client = new BawClient(fake.runner);
    const error = await client.walletStatus().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("BAW_INVALID_OUTPUT");
    expect((error as CliError).message).not.toContain("not json");
  });

  it("preserves BAW preview risks on rejection", async () => {
    const risks = {
      riskDetails: [
        { code: "RISK_001", title: "High Risk Address", description: "Flagged target", riskType: "RISK" },
      ],
    };
    const fake = fakeBaw(() =>
      fail({
        code: 351803,
        name: "AGENT_DEV_MODE_RISK_BLOCKED",
        message: "High risk transaction",
        data: { blockLevel: "Block", risks },
      }),
    );
    const client = new BawClient(fake.runner);
    const error = await previewCall(client, BSC_ADDRESS, CALL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("BAW_PREVIEW_REJECTED");
    expect((error as CliError).details?.bawError).toMatchObject({
      name: "AGENT_DEV_MODE_RISK_BLOCKED",
      data: { risks },
    });
  });
});

describe("previewCall", () => {
  it("returns requestId, parsedTx, risks, confirmation flag, and next command", async () => {
    const fake = fakeBaw(() =>
      previewEnvelope({
        requireConfirmation: true,
        risks: { riskDetails: [{ code: "R1", title: "Caution", description: "Review", riskType: "CAUTION" }] },
      }),
    );
    const result = await previewCall(new BawClient(fake.runner), BSC_ADDRESS, CALL);
    expect(result.preview.requestId).toBe("req-1");
    expect(result.preview.requireConfirmation).toBe(true);
    expect(result.preview.nextCommand).toBe("agentswap tx execute --request-id req-1 --confirm");
    expect(result.preview.risks).toMatchObject({ riskDetails: [{ code: "R1" }] });
    expect(previewWarnings(result.preview)).toContain("Execution will require confirmation in the Binance App.");
  });

  it("rejects a preview without a requestId", async () => {
    const fake = fakeBaw(() => ok({ parsedTx: {}, requireConfirmation: false }));
    const error = await previewCall(new BawClient(fake.runner), BSC_ADDRESS, CALL).catch(
      (caught: unknown) => caught,
    );
    expect((error as CliError).code).toBe("BAW_INVALID_OUTPUT");
  });

  it("surfaces simulation errors and risk counts as warnings", () => {
    const warnings = previewWarnings({
      requestId: "r",
      parsedTx: null,
      simulationResult: { simulationErrorDetail: "execution reverted" },
      risks: { riskDetails: [{}, {}] },
      tokenInfos: null,
      requireConfirmation: false,
      expiresAt: null,
      nextCommand: "next",
    });
    expect(warnings.join(" ")).toContain("execution reverted");
    expect(warnings.join(" ")).toContain("2 transaction-level risk");
  });
});

describe("BawCommandError", () => {
  it("preserves the original BAW error metadata", () => {
    const error = new BawCommandError({
      code: 42,
      name: "INVALID_PARAMS",
      message: "bad params",
      data: { field: "x" },
    });
    expect(error.code).toBe("BAW_ERROR");
    expect(error.bawError.name).toBe("INVALID_PARAMS");
  });
});

describe("versionAtLeast", () => {
  it("compares semantic versions", () => {
    expect(versionAtLeast("1.12.0", "1.12.0")).toBe(true);
    expect(versionAtLeast("1.12.0", "1.12.0")).toBe(true);
    expect(versionAtLeast("1.10.9", "1.12.0")).toBe(false);
    expect(versionAtLeast("2.0.0", "1.12.0")).toBe(true);
    expect(versionAtLeast("garbage", "1.12.0")).toBe(false);
  });
});
