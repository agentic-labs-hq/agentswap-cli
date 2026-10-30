import { describe, expect, it } from "vitest";

import { BawClient } from "../src/baw.js";
import { checkAgenticWallet, type AgentIdStatus } from "../src/core/wallet-checks.js";
import { BSC_ADDRESS, connectedBawHandler, fail, fakeBaw, ok } from "./helpers/fake-baw.js";

const eligible: AgentIdStatus = { eligible: true, member: true, facility: false, category: 0 };
const ineligible: AgentIdStatus = { eligible: false, member: false, facility: false, category: 0 };

describe("checkAgenticWallet", () => {
  it("reports a connected, dev-mode, eligible wallet", async () => {
    const fake = fakeBaw(connectedBawHandler());
    const report = await checkAgenticWallet(new BawClient(fake.runner), {
      eligibility: async () => eligible,
      bnbBalance: async () => 10n ** 18n,
    });
    expect(report.available).toBe(true);
    expect(report.status).toBe("CONNECTED");
    expect(report.address).toBe(BSC_ADDRESS);
    expect(report.devMode.enabled).toBe(true);
    expect(report.agentId?.eligible).toBe(true);
    expect(report.bnbBalance).toBe("1");
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("reports UNCONNECTED without calling address/settings", async () => {
    const fake = fakeBaw((args) => {
      if (args[0] === "--version") return "1.11.0\n";
      if (args[1] === "status") return ok({ status: "UNCONNECTED" });
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    const report = await checkAgenticWallet(new BawClient(fake.runner));
    expect(report.status).toBe("UNCONNECTED");
    expect(report.address).toBeNull();
    expect(report.checks.some((check) => check.name === "baw wallet connected" && check.status === "fail")).toBe(true);
    expect(report.warnings.join(" ")).toContain("baw auth signin");
    expect(fake.calls.some((call) => call[1] === "address")).toBe(false);
  });

  it("fails the Developer Mode check when disabled", async () => {
    const fake = fakeBaw(connectedBawHandler({ devMode: false }));
    const report = await checkAgenticWallet(new BawClient(fake.runner));
    expect(report.devMode.enabled).toBe(false);
    expect(report.checks.some((check) => check.name === "baw developer mode" && check.status === "fail")).toBe(true);
    expect(report.warnings.join(" ")).toContain("Binance App");
  });

  it("warns when the wallet is not Agent ID eligible", async () => {
    const fake = fakeBaw(connectedBawHandler());
    const report = await checkAgenticWallet(new BawClient(fake.runner), {
      eligibility: async () => ineligible,
    });
    expect(report.agentId?.eligible).toBe(false);
    expect(report.checks.some((check) => check.name === "agent id eligible" && check.status === "warn")).toBe(true);
    expect(report.warnings.join(" ")).toContain("not eligible");
  });

  it("fails the version check for an old baw", async () => {
    const fake = fakeBaw(connectedBawHandler({ version: "1.10.0" }));
    const report = await checkAgenticWallet(new BawClient(fake.runner));
    expect(report.checks.some((check) => check.name === "baw version" && check.status === "fail")).toBe(true);
  });

  it("throws BAW_UNAVAILABLE when BAW cannot reach Binance", async () => {
    const fake = fakeBaw((args) => {
      if (args[0] === "--version") return "1.11.0\n";
      return fail({ code: 50001001, name: "NETWORK_ERROR", message: "TLS connection failed" });
    });
    await expect(checkAgenticWallet(new BawClient(fake.runner))).rejects.toMatchObject({
      code: "BAW_UNAVAILABLE",
    });
  });

  it("returns a tolerant BAW error report for status", async () => {
    const fake = fakeBaw((args) => {
      if (args[0] === "--version") return "1.11.0\n";
      return fail({ code: 50001001, name: "NETWORK_ERROR", message: "TLS connection failed" });
    });
    const report = await checkAgenticWallet(new BawClient(fake.runner), { tolerant: true });
    expect(report.available).toBe(false);
    expect(report.error).toEqual({ code: "BAW_UNAVAILABLE", message: "TLS connection failed" });
    expect(report.checks.some((check) => check.status === "fail")).toBe(true);
  });

  it("warns when tx-lock is LOCKED", async () => {
    const fake = fakeBaw(connectedBawHandler({ txLock: "LOCKED" }));
    const report = await checkAgenticWallet(new BawClient(fake.runner));
    expect(report.txLock).toBe("LOCKED");
    expect(report.warnings.join(" ")).toContain("LOCKED");
  });
});
