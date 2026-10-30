import { getAddress, type Address } from "viem";

import type { BawClient, BawWalletSettings } from "./baw.js";
import { CliError } from "./errors.js";

export interface AgenticWalletRead {
  status: string;
  address: Address;
}

export interface AgenticWallet extends AgenticWalletRead {
  settings: BawWalletSettings;
  devModeEnabled: boolean;
}

/** Select the BSC address from `baw wallet address --json`. */
export function extractBscAddress(addresses: readonly { binanceChainId: string | number; address: string }[]): Address {
  const bsc = addresses.find((entry) => String(entry.binanceChainId) === "56");
  if (bsc === undefined) {
    throw new CliError(
      "BAW_NO_BSC_ADDRESS",
      "The Binance Agentic Wallet has no BSC address (binanceChainId 56). Create/activate a BSC wallet in the Binance App.",
    );
  }
  try {
    return getAddress(bsc.address);
  } catch {
    throw new CliError("BAW_INVALID_ADDRESS", "The Binance Agentic Wallet returned an invalid BSC address.");
  }
}

/** Require a connected wallet and return its BSC address. No settings/devMode call. */
export async function loadWalletForRead(baw: BawClient): Promise<AgenticWalletRead> {
  const status = await baw.walletStatus();
  if (status.status !== "CONNECTED") {
    throw new CliError(
      "BAW_NOT_CONNECTED",
      `Binance Agentic Wallet status is ${status.status}. Sign in with \`baw auth signin\` and approve the QR/request in the Binance App.`,
    );
  }
  const addressBook = await baw.walletAddress();
  return {
    status: status.status,
    address: extractBscAddress(addressBook.addresses ?? []),
  };
}

export function devModeEnabled(settings: BawWalletSettings): boolean {
  return settings.devMode?.enabled === true;
}

/** Require Developer Mode before any external-sign action (preview or execute). */
export async function assertDevMode(baw: BawClient): Promise<void> {
  const settings = await baw.walletSettings();
  if (!devModeEnabled(settings)) {
    throw new CliError(
      "DEVMODE_REQUIRED",
      "Developer Mode is disabled for the Binance Agentic Wallet. Enable Developer Mode in the Binance App (Agentic Wallet > Settings) before previewing or executing external contract calls.",
    );
  }
}

/** Require CONNECTED + Developer Mode; used by every preview command. */
export async function loadWalletForPreview(baw: BawClient): Promise<AgenticWallet> {
  const wallet = await loadWalletForRead(baw);
  const settings = await baw.walletSettings();
  if (!devModeEnabled(settings)) {
    throw new CliError(
      "DEVMODE_REQUIRED",
      "Developer Mode is disabled for the Binance Agentic Wallet. Enable Developer Mode in the Binance App (Agentic Wallet > Settings) before previewing external contract calls.",
    );
  }
  return { ...wallet, settings, devModeEnabled: true };
}
