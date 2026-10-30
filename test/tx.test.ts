import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BawClient } from "../src/baw.js";
import { runTxExecute } from "../src/core/tx-execute.js";
import { runTxStatus } from "../src/core/tx-status.js";
import { CliError, UsageError } from "../src/errors.js";
import { createRuntime } from "../src/runtime.js";
import { defaultStateDir, FileStateStore } from "../src/state.js";
import { BSC_ADDRESS, connectedBawHandler, fail, fakeBaw, ok, removeDir, tempDir } from "./helpers/fake-baw.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDir(dirs.pop()!);
});

function runtimeWith(handler: (args: string[]) => unknown) {
  const fake = fakeBaw(handler as never);
  return { runtime: createRuntime({ baw: new BawClient(fake.runner) }), fake };
}

function store(): { store: FileStateStore; dir: string } {
  const dir = tempDir();
  dirs.push(dir);
  return { store: new FileStateStore(dir), dir };
}

async function seedPreview(journal: FileStateStore, requestId: string): Promise<void> {
  await journal.recordPreview({
    requestId,
    chainId: 56,
    wallet: BSC_ADDRESS,
    to: "0x3333333333333333333333333333333333333333",
    value: "0",
    inputDataHash: `0x${"11".repeat(32)}`,
    action: "test action",
    functionName: "test()",
    expiresAt: null,
  });
}

describe("tx execute", () => {
  it("requires Developer Mode at execute time", async () => {
    const { runtime, fake } = runtimeWith(
      connectedBawHandler({ devMode: false, onExecute: () => ok({ orderId: "order-x", status: "BROADCASTED", txHash: null }) }),
    );
    await expect(
      runTxExecute(runtime, { requestId: "req-x", confirm: true }, { stateStore: store().store }),
    ).rejects.toMatchObject({ code: "DEVMODE_REQUIRED" });
    expect(fake.calls.some((call) => call[0] === "contract-call" && call[1] === "execute")).toBe(false);
  });

  it("refuses without --confirm and never calls BAW", async () => {
    const { runtime, fake } = runtimeWith(() => {
      throw new Error("must not be called");
    });
    await expect(
      runTxExecute(runtime, { requestId: "req-1", confirm: false }, { stateStore: store().store }),
    ).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
    expect(fake.calls).toEqual([]);
  });

  it("rejects a requestId that was not locally previewed and never calls execute", async () => {
    const { runtime, fake } = runtimeWith(
      connectedBawHandler({ onExecute: () => ok({ orderId: "order-x", status: "BROADCASTED", txHash: null }) }),
    );
    const { store: journal } = store();
    await expect(
      runTxExecute(runtime, { requestId: "not-previewed", confirm: true }, { stateStore: journal }),
    ).rejects.toMatchObject({ code: "PREVIEW_NOT_FOUND" });
    expect(fake.calls.some((call) => call[0] === "contract-call" && call[1] === "execute")).toBe(false);
  });

  it("executes with --confirm and journals a pending order", async () => {
    const { runtime, fake } = runtimeWith(
      connectedBawHandler({
        onExecute: () =>
          ok({
            orderId: "order-1",
            status: "PENDING_CONFIRMATION",
            txHash: null,
            message: "Please confirm in the Binance App",
          }),
      }),
    );
    const { store: journal } = store();
    await seedPreview(journal, "req-1");
    const result = await runTxExecute(
      runtime,
      { requestId: "req-1", confirm: true },
      { stateStore: journal },
    );
    expect(fake.calls).toContainEqual(["contract-call", "execute", "--requestId", "req-1", "--json"]);
    expect(result).toMatchObject({
      status: "PENDING_CONFIRMATION",
      orderId: "order-1",
      txHash: null,
      executed: true,
    });
    expect((result.next as Record<string, unknown>).action).toBe("confirm-in-binance-app");
    const record = await journal.findExecution("order-1");
    expect(record).toMatchObject({ requestId: "req-1", status: "PENDING_CONFIRMATION", txHash: null });
  });

  it("broadcasts and returns the tx-hash next command", async () => {
    const txHash = `0x${"cd".repeat(32)}`;
    const { runtime } = runtimeWith(
      connectedBawHandler({
        onExecute: () => ok({ orderId: "order-2", status: "BROADCASTED", txHash, message: null }),
      }),
    );
    const { store: journal } = store();
    await seedPreview(journal, "req-2");
    const result = await runTxExecute(runtime, { requestId: "req-2", confirm: true }, { stateStore: journal });
    expect(result).toMatchObject({ status: "BROADCASTED", txHash });
    expect((result.next as Record<string, unknown>).command).toBe(`agentswap tx status --tx-hash ${txHash}`);
  });
});

describe("tx status", () => {
  it("queries BAW by tx hash", async () => {
    const txHash = `0x${"ab".repeat(32)}`;
    const { runtime, fake } = runtimeWith((args) =>
      ok({ binanceChainId: args[3], txHash: args[3], status: "SUCCESS", txTime: "2026-01-01T00:00:00+08:00" }),
    );
    const result = await runTxStatus(runtime, { txHash }, { stateStore: store().store });
    expect(result.source).toBe("baw");
    expect(result.status).toBe("SUCCESS");
    expect(fake.calls[0]).toEqual([
      "wallet",
      "tx-history",
      "--tx",
      txHash,
      "--binanceChainId",
      "56",
      "--json",
    ]);
  });

  it("reads a local order journal and enriches it from BAW", async () => {
    const txHash = `0x${"ab".repeat(32)}`;
    const { store: journal } = store();
    await journal.recordExecution({
      requestId: "req-1",
      orderId: "order-1",
      status: "PENDING_CONFIRMATION",
      txHash,
      message: null,
    });
    const { runtime } = runtimeWith(() => ok({ binanceChainId: "56", txHash, status: "SUCCESS" }));
    const result = await runTxStatus(runtime, { orderId: "order-1" }, { stateStore: journal });
    expect(result.source).toBe("local-journal");
    expect(result.status).toBe("SUCCESS");
    expect(result.orderId).toBe("order-1");
    expect(result.requestId).toBe("req-1");
  });

  it("marks a failed BAW refresh as stale-local, not updated", async () => {
    const txHash = `0x${"ab".repeat(32)}`;
    const { store: journal } = store();
    await journal.recordExecution({
      requestId: "req-1",
      orderId: "order-1",
      status: "PENDING_CONFIRMATION",
      txHash,
      message: null,
    });
    const { runtime } = runtimeWith(() => fail({ code: 500, message: "BAW unavailable" }));
    const result = await runTxStatus(runtime, { orderId: "order-1" }, { stateStore: journal });
    expect(result.status).toBe("PENDING_CONFIRMATION");
    expect(result.freshness).toBe("stale-local");
    expect(String(result.note)).toContain("Could not refresh");
  });

  it("returns the journaled status without a tx hash", async () => {
    const { store: journal } = store();
    await journal.recordExecution({
      requestId: "req-1",
      orderId: "order-1",
      status: "PENDING_CONFIRMATION",
      txHash: null,
      message: "Please confirm in the Binance App",
    });
    const { runtime, fake } = runtimeWith(() => {
      throw new Error("should not call BAW");
    });
    const result = await runTxStatus(runtime, { orderId: "order-1" }, { stateStore: journal });
    expect(result.status).toBe("PENDING_CONFIRMATION");
    expect(String(result.note)).toContain("Binance App");
    expect(fake.calls).toEqual([]);
  });

  it("requires exactly one selector and a valid tx hash", async () => {
    const { runtime } = runtimeWith(() => {
      throw new Error("should not call BAW");
    });
    await expect(runTxStatus(runtime, {}, { stateStore: store().store })).rejects.toBeInstanceOf(UsageError);
    await expect(
      runTxStatus(runtime, { orderId: "o", txHash: `0x${"ab".repeat(32)}` }, { stateStore: store().store }),
    ).rejects.toBeInstanceOf(UsageError);
    await expect(
      runTxStatus(runtime, { txHash: "0x1234" }, { stateStore: store().store }),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("reports ORDER_NOT_FOUND for an unknown local order", async () => {
    const { runtime } = runtimeWith(() => {
      throw new Error("should not call BAW");
    });
    const error = await runTxStatus(runtime, { orderId: "missing" }, { stateStore: store().store }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("ORDER_NOT_FOUND");
  });
});

describe("state journal", () => {
  it("uses AGENTSWAP_STATE_DIR and ignores the legacy state env", () => {
    expect(defaultStateDir({ AGENTSWAP_STATE_DIR: "/tmp/agentswap-state" })).toBe("/tmp/agentswap-state");
    const legacyEnv = { [["AGENTIC", "STATE", "DIR"].join("_")]: "/tmp/legacy-state" } as NodeJS.ProcessEnv;
    expect(defaultStateDir(legacyEnv)).not.toBe("/tmp/legacy-state");
  });

  it("binds a preview to chain and wallet and consumes it once", async () => {
    const { store: journal } = store();
    await seedPreview(journal, "req-bind");
    await expect(
      journal.consumePreview("req-bind", { chainId: 1, wallet: BSC_ADDRESS }),
    ).rejects.toMatchObject({ code: "PREVIEW_CHAIN_MISMATCH" });
    await expect(
      journal.consumePreview("req-bind", {
        chainId: 56,
        wallet: "0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_WALLET_MISMATCH" });
    const consumed = await journal.consumePreview("req-bind", { chainId: 56, wallet: BSC_ADDRESS });
    expect(consumed.usedAt).not.toBeNull();
    await expect(
      journal.consumePreview("req-bind", { chainId: 56, wallet: BSC_ADDRESS }),
    ).rejects.toMatchObject({ code: "PREVIEW_ALREADY_USED" });
  });

  it("creates a fresh nested state directory on first preview", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const journal = new FileStateStore(join(dir, "nested", "state"));
    await seedPreview(journal, "req-fresh");
    expect(await journal.findExecution("order-fresh")).toBeNull();
  });

  it("fails closed on a stale lock instead of auto-reclaiming", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const stateDir = join(dir, "state");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "tx-journal.json.lock"), '{"pid":999999}\n', "utf8");
    const journal = new FileStateStore(stateDir, 50);
    await expect(
      journal.recordPreview({
        requestId: "req-stale",
        chainId: 56,
        wallet: BSC_ADDRESS,
        to: "0x3333333333333333333333333333333333333333",
        value: "0",
        inputDataHash: `0x${"33".repeat(32)}`,
        action: "stale",
        functionName: "test()",
        expiresAt: null,
      }),
    ).rejects.toMatchObject({ code: "STATE_LOCK_TIMEOUT" });
  });

  it("serializes concurrent preview writes and consumes a preview exactly once", async () => {
    const { store: journal, dir } = store();
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        journal.recordPreview({
          requestId: `req-concurrent-${index}`,
          chainId: 56,
          wallet: BSC_ADDRESS,
          to: "0x3333333333333333333333333333333333333333",
          value: "0",
          inputDataHash: `0x${"22".repeat(32)}`,
          action: "concurrent",
          functionName: "test()",
          expiresAt: null,
        }),
      ),
    );
    const written = JSON.parse(await readFile(join(dir, "tx-journal.json"), "utf8")) as {
      previews: Record<string, unknown>;
    };
    expect(Object.keys(written.previews)).toHaveLength(20);

    await seedPreview(journal, "req-once");
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        journal.consumePreview("req-once", { chainId: 56, wallet: BSC_ADDRESS }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    if (rejected?.status === "rejected") {
      expect((rejected.reason as { code?: string }).code).toBe("PREVIEW_ALREADY_USED");
    }
  });

  it("writes and reads back executions", async () => {
    const { store: journal } = store();
    expect(await journal.findExecution("order-x")).toBeNull();
    const saved = await journal.recordExecution({
      requestId: "req-x",
      orderId: "order-x",
      status: "BROADCASTED",
      txHash: `0x${"ef".repeat(32)}`,
      message: null,
    });
    expect(saved.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await journal.findExecution("order-x")).toMatchObject({ requestId: "req-x", status: "BROADCASTED" });
  });
});

describe("connected BAW handler sanity", () => {
  it("is usable by tx tests", () => {
    expect(connectedBawHandler()(["wallet", "status", "--json"])).toMatchObject({ success: true });
  });
});
