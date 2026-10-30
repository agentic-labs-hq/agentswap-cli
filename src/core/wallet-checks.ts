import type { Address } from "viem";

import {
  REQUIRED_BAW_VERSION,
  versionAtLeast,
  type BawClient,
  type BawWalletSettings,
} from "../baw.js";
import { CliError } from "../errors.js";
import { extractBscAddress } from "../wallet.js";
import { shortError, type Check } from "./common.js";
import { formatTokenAmount } from "../lib/parse.js";

export interface AgentIdStatus {
  eligible: boolean;
  member: boolean;
  facility: boolean;
  category: number;
}

export interface WalletCheckOptions {
  /** Status is a report: capture BAW errors instead of throwing. */
  tolerant?: boolean;
  eligibility?: (address: Address) => Promise<AgentIdStatus>;
  bnbBalance?: (address: Address) => Promise<bigint>;
}

export interface WalletCheckReport {
  available: boolean;
  version: string | null;
  status: string | null;
  address: Address | null;
  settings: BawWalletSettings | null;
  devMode: { enabled: boolean | null; expiresAt: number | null };
  agentId: AgentIdStatus | null;
  bnbBalanceWei: string | null;
  bnbBalance: string | null;
  txLock: string | null;
  error: { code: string; message: string } | null;
  checks: Check[];
  warnings: string[];
}

function errorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof CliError) return { code: error.code, message: error.message };
  return { code: "BAW_UNAVAILABLE", message: error instanceof Error ? error.message : String(error) };
}

/**
 * Evaluate the Binance Agentic Wallet preflight: CLI version, CONNECTED status,
 * BSC address, Developer Mode, Agent ID eligibility, BNB balance, tx-lock.
 * No signing, no preview, no state change. Doctor throws on BAW unavailability;
 * status passes `tolerant: true` to return a report.
 */
export async function checkAgenticWallet(
  baw: BawClient,
  options: WalletCheckOptions = {},
): Promise<WalletCheckReport> {
  const checks: Check[] = [];
  const warnings: string[] = [];
  const report: WalletCheckReport = {
    available: false,
    version: null,
    status: null,
    address: null,
    settings: null,
    devMode: { enabled: null, expiresAt: null },
    agentId: null,
    bnbBalanceWei: null,
    bnbBalance: null,
    txLock: null,
    error: null,
    checks,
    warnings,
  };

  try {
    const version = await baw.version();
    report.available = true;
    report.version = version;
    if (versionAtLeast(version, REQUIRED_BAW_VERSION)) {
      checks.push({ name: "baw version", status: "ok", detail: version });
    } else {
      checks.push({
        name: "baw version",
        status: "fail",
        detail: `${version} is older than required ${REQUIRED_BAW_VERSION}; run npm install -g @binance/agentic-wallet@${REQUIRED_BAW_VERSION}`,
      });
      warnings.push(`Update the Binance Agentic Wallet CLI to ${REQUIRED_BAW_VERSION} or newer.`);
    }

    const status = await baw.walletStatus();
    report.status = status.status;
    if (status.status !== "CONNECTED") {
      checks.push({
        name: "baw wallet connected",
        status: "fail",
        detail: `status is ${status.status}`,
      });
      warnings.push(
        "Binance Agentic Wallet is not connected. Sign in with `baw auth signin` and approve the request in the Binance App.",
      );
      return report;
    }
    checks.push({ name: "baw wallet connected", status: "ok" });

    const addressBook = await baw.walletAddress();
    report.address = extractBscAddress(addressBook.addresses ?? []);
    checks.push({ name: "baw BSC address", status: "ok", detail: report.address });

    const settings = await baw.walletSettings();
    report.settings = settings;
    const enabled = settings.devMode?.enabled === true;
    report.devMode = {
      enabled,
      expiresAt: settings.devMode?.expiresAt ?? null,
    };
    checks.push(
      enabled
        ? { name: "baw developer mode", status: "ok" }
        : {
            name: "baw developer mode",
            status: "fail",
            detail: "devMode.enabled is false; contract-call preview is unavailable",
          },
    );
    if (!enabled) {
      warnings.push(
        "Developer Mode is disabled. Enable it in the Binance App (Agentic Wallet > Settings) before building transactions.",
      );
    }

    if (options.eligibility !== undefined && report.address !== null) {
      const agentId = await options.eligibility(report.address);
      report.agentId = agentId;
      if (agentId.eligible) {
        checks.push({ name: "agent id eligible", status: "ok" });
      } else {
        checks.push({
          name: "agent id eligible",
          status: "warn",
          detail: "wallet is not eligible under the protocol policy (no active Agent ID/facility)",
        });
        warnings.push(
          "The Agentic Wallet is not eligible under the protocol policy. It can still create tokens, but cannot receive gated tokens, hold gated LP, or swap gated assets.",
        );
      }
    }

    if (options.bnbBalance !== undefined && report.address !== null) {
      const balance = await options.bnbBalance(report.address);
      report.bnbBalanceWei = balance.toString();
      report.bnbBalance = formatTokenAmount(balance, 18);
      checks.push({
        name: "bnb balance",
        status: balance > 0n ? "ok" : "warn",
        detail: `${report.bnbBalance} BNB`,
      });
      if (balance === 0n) warnings.push("The Agentic Wallet has 0 BNB for gas.");
    }

    try {
      const lock = await baw.walletTxLock();
      report.txLock = lock.status;
      if (lock.status !== "UNLOCKED") {
        checks.push({ name: "wallet tx-lock", status: "warn", detail: lock.status });
        warnings.push(`The Agentic Wallet is ${lock.status}; resolve pending/App-confirmation transactions first.`);
      } else {
        checks.push({ name: "wallet tx-lock", status: "ok" });
      }
    } catch (error) {
      report.txLock = null;
      warnings.push(`Could not read wallet tx-lock: ${shortError(error)}`);
    }
  } catch (error) {
    if (options.tolerant !== true) throw error;
    report.error = errorInfo(error);
    report.available = false;
    checks.push({ name: "baw available", status: "fail", detail: report.error.message });
    warnings.push(`Binance Agentic Wallet unavailable: ${report.error.message}`);
  }

  report.checks = checks;
  report.warnings = [...new Set(warnings)];
  return report;
}
