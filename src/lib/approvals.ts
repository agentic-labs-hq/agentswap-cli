import type { Address } from "viem";

export interface ApprovalAsset {
  token: Address;
  symbol: string | null;
  allowance: bigint;
  /** Desired allowance for the operation. Zero amounts never need approval. */
  amount: bigint;
  /** Gated AgenticToken: standard approve; non-gated quote tokens may need USDT-style reset. */
  gated: boolean;
}

export interface ApprovalStep {
  kind: "approve" | "reset";
  token: Address;
  symbol: string | null;
  spender: Address;
  amount: bigint;
  /** True when this approve must follow a reset-to-zero step. */
  resetFirst: boolean;
  reason: string;
}

/**
 * Plan exact-amount approvals. A non-gated token with a non-zero but
 * insufficient allowance gets a reset-to-zero step first (USDT-style), then the
 * exact approval. Gated AgenticTokens approve the exact amount directly.
 */
export function planApprovals(spender: Address, assets: readonly ApprovalAsset[]): ApprovalStep[] {
  const steps: ApprovalStep[] = [];
  for (const asset of assets) {
    if (asset.amount <= 0n) continue;
    if (asset.allowance >= asset.amount) continue;
    const needsReset = !asset.gated && asset.allowance > 0n;
    if (needsReset) {
      steps.push({
        kind: "reset",
        token: asset.token,
        symbol: asset.symbol,
        spender,
        amount: 0n,
        resetFirst: false,
        reason: "non-zero allowance must be reset to zero first (USDT-style token)",
      });
    }
    steps.push({
      kind: "approve",
      token: asset.token,
      symbol: asset.symbol,
      spender,
      amount: asset.amount,
      resetFirst: needsReset,
      reason: needsReset ? "exact allowance after reset" : "exact allowance for the operation",
    });
  }
  return steps;
}
