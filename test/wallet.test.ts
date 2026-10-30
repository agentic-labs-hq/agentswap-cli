import { describe, expect, it } from "vitest";

import { BawClient } from "../src/baw.js";
import { CliError } from "../src/errors.js";
import { loadWalletForPreview, loadWalletForRead } from "../src/wallet.js";
import { BSC_ADDRESS, connectedBawHandler, fakeBaw, ok } from "./helpers/fake-baw.js";

describe("wallet loaders", () => {
  it("reads the BSC address without fetching settings", async () => {
    const fake = fakeBaw(connectedBawHandler());
    const wallet = await loadWalletForRead(new BawClient(fake.runner));
    expect(wallet.address).toBe(BSC_ADDRESS);
    expect(fake.calls.some((call) => call[1] === "settings")).toBe(false);
  });

  it("requires CONNECTED before address lookups", async () => {
    const fake = fakeBaw((args) => {
      if (args[0] === "wallet" && args[1] === "status") return ok({ status: "UNCONNECTED" });
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    await expect(loadWalletForRead(new BawClient(fake.runner))).rejects.toMatchObject({
      code: "BAW_NOT_CONNECTED",
    });
  });

  it("requires Developer Mode for preview commands", async () => {
    const fake = fakeBaw(connectedBawHandler({ devMode: false }));
    const error = await loadWalletForPreview(new BawClient(fake.runner)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("DEVMODE_REQUIRED");
    expect((error as CliError).message).toContain("Binance App");
  });

  it("returns the connected preview wallet when Developer Mode is enabled", async () => {
    const fake = fakeBaw(connectedBawHandler({ devMode: true }));
    const wallet = await loadWalletForPreview(new BawClient(fake.runner));
    expect(wallet).toMatchObject({ address: BSC_ADDRESS, status: "CONNECTED", devModeEnabled: true });
  });

  it("rejects an address book without BSC", async () => {
    const fake = fakeBaw((args) => {
      if (args[0] === "wallet" && args[1] === "status") return ok({ status: "CONNECTED" });
      if (args[0] === "wallet" && args[1] === "address") {
        return ok({ addresses: [{ binanceChainId: "1", address: "0x2222222222222222222222222222222222222222" }] });
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    await expect(loadWalletForRead(new BawClient(fake.runner))).rejects.toMatchObject({
      code: "BAW_NO_BSC_ADDRESS",
    });
  });
});
