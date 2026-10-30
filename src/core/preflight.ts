import { FACILITY_CATEGORY, type Sdk } from "../vendor/sdk/index.js";
import { getAddress, zeroAddress, type Address } from "viem";

import { CliError } from "../errors.js";
import { sameAddress } from "../lib/ordering.js";
import { shortError } from "./common.js";

export interface GatedAssetInfo {
  address: Address;
  gated: boolean;
  creator: Address | null;
  policy: Address | null;
}

/** Read the gated-asset registry entry for a token. */
export async function gatedAssetInfo(sdk: Sdk, token: Address): Promise<GatedAssetInfo> {
  const registry = sdk.registries.assetRegistry();
  const gated = await registry.isRegistered(token);
  if (!gated) return { address: token, gated: false, creator: null, policy: null };
  const [creator, policy] = await Promise.all([registry.creatorOf(token), registry.policyOf(token)]);
  return { address: token, gated: true, creator, policy };
}

/** Resolve an explicit policy or the policy registry's current default. */
export async function resolvePolicy(
  sdk: Sdk,
  explicit: Address | undefined,
): Promise<{ address: Address; source: "explicit" | "current" }> {
  const registry = sdk.registries.policyRegistry();
  if (explicit !== undefined) {
    const allowed = await registry.isPolicyAllowed(explicit);
    if (!allowed) {
      throw new CliError("POLICY_NOT_ALLOWED", `Policy ${explicit} is not registered/allowed by the policy registry.`);
    }
    return { address: explicit, source: "explicit" };
  }
  const current = await registry.currentPolicy();
  if (current === zeroAddress) {
    throw new CliError("POLICY_NOT_SET", "The policy registry has no current policy; pass --policy explicitly.");
  }
  const allowed = await registry.isPolicyAllowed(current);
  if (!allowed) {
    throw new CliError("POLICY_NOT_ALLOWED", `Current policy ${current} is not registered/allowed by the policy registry.`);
  }
  return { address: current, source: "current" };
}

/**
 * Mirror the token factory's initial-recipient gate locally so failures are
 * clear before simulation: agents (category NONE + Agent ID) or active
 * CUSTODY/PURPOSE facilities only.
 */
export async function assertInitialRecipientsEligible(
  sdk: Sdk,
  policyAddress: Address,
  recipients: readonly Address[],
): Promise<void> {
  const policy = sdk.registries.transferPolicy(policyAddress);
  const venue = sdk.registries.venueRegistry();
  const problems = (
    await Promise.all(
      recipients.map(async (recipient) => {
        try {
          const category = await policy.categoryOf(recipient);
          if (category === FACILITY_CATEGORY.CUSTODY || category === FACILITY_CATEGORY.PURPOSE) {
            const active = await venue.isFacilityOfCategory(recipient, category);
            return active
              ? null
              : `${recipient} is a revoked/inactive CUSTODY/PURPOSE facility and cannot receive initial supply`;
          }
          if (category !== FACILITY_CATEGORY.NONE) {
            return `${recipient} has facility category ${category}; only agents or active CUSTODY/PURPOSE facilities can receive initial supply`;
          }
          const member = await policy.isMember(recipient);
          return member ? null : `${recipient} has no active Agent ID (not eligible under policy ${policyAddress})`;
        } catch (error) {
          return `${recipient} eligibility check failed: ${shortError(error)}`;
        }
      }),
    )
  ).filter((item): item is string => item !== null);

  if (problems.length > 0) {
    throw new CliError("RECIPIENT_NOT_ELIGIBLE", `Invalid token initial recipient(s): ${problems.join("; ")}.`, {
      recipients,
    });
  }
}

export interface PoolPreflight {
  token: GatedAssetInfo;
  quote: GatedAssetInfo;
}

/**
 * Validate the gated pool creation rules before simulating:
 * creator of every gated side must be the wallet; every non-gated side must be
 * an approved quote asset; at least one side must be gated.
 */
export async function assertPoolCreatePreflight(
  sdk: Sdk,
  token: Address,
  quote: Address,
  wallet: Address,
): Promise<PoolPreflight> {
  const [tokenInfo, quoteInfo] = await Promise.all([gatedAssetInfo(sdk, token), gatedAssetInfo(sdk, quote)]);

  if (!tokenInfo.gated && !quoteInfo.gated) {
    throw new CliError(
      "NO_GATED_ASSET",
      "At least one pool side must be a registered Agentic gated asset; no public/public pools are allowed.",
    );
  }
  for (const [side, info] of [
    ["token", tokenInfo],
    ["quote", quoteInfo],
  ] as const) {
    if (info.gated && info.creator !== null && !sameAddress(info.creator, wallet)) {
      throw new CliError(
        "NOT_ASSET_CREATOR",
        `Wallet ${wallet} is not the creator of gated ${side} ${info.address} (creator is ${info.creator}).`,
      );
    }
  }

  const quoteRegistry = sdk.registries.quoteAssetRegistry();
  if (!tokenInfo.gated) {
    const approved = await quoteRegistry.isQuoteAsset(token);
    if (!approved) throw new CliError("NOT_QUOTE_ASSET", `token ${token} is not a registered gated asset or an approved quote asset.`);
  }
  if (!quoteInfo.gated) {
    const approved = await quoteRegistry.isQuoteAsset(quote);
    if (!approved) throw new CliError("NOT_QUOTE_ASSET", `quote ${quote} is not a registered gated asset or an approved quote asset.`);
  }

  return { token: tokenInfo, quote: quoteInfo };
}

/** position-manager gating: LP recipient and payer must be agents for every gated token in the pool. */
export async function assertLpRecipientsEligible(
  sdk: Sdk,
  token0: Address,
  token1: Address,
  recipient: Address,
  wallet: Address,
): Promise<void> {
  const npm = sdk.dex.positionManager();
  const checks: Array<{ token: Address; account: Address; role: string }> = [
    { token: token0, account: recipient, role: "position recipient" },
    { token: token1, account: recipient, role: "position recipient" },
    { token: token0, account: wallet, role: "LP payer/caller" },
    { token: token1, account: wallet, role: "LP payer/caller" },
  ];
  const results = await Promise.all(
    checks.map(async (check) => ({
      ...check,
      allowed: await npm.isAllowedRecipient(check.token, check.account),
    })),
  );
  const denied = results.filter((result) => !result.allowed);
  if (denied.length > 0) {
    throw new CliError(
      "LP_NOT_AGENT",
      `Gated LP requires an Agent ID for both recipient and payer (neither may be a facility): ${denied
        .map((item) => `${item.role} ${item.account} for token ${item.token}`)
        .join("; ")}.`,
    );
  }
}

/** Router/transfer gating: gated input needs an agent payer; gated output needs an agent recipient. */
export async function assertSwapEligible(
  sdk: Sdk,
  tokenIn: Address,
  tokenOut: Address,
  wallet: Address,
  recipient: Address,
): Promise<void> {
  const npm = sdk.dex.positionManager();
  const [inGated, outGated] = await Promise.all([
    gatedAssetInfo(sdk, tokenIn),
    gatedAssetInfo(sdk, tokenOut),
  ]);
  if (inGated.gated) {
    const allowed = await npm.isAllowedRecipient(tokenIn, wallet);
    if (!allowed) {
      throw new CliError(
        "SWAP_PAYER_NOT_AGENT",
        `Gated tokenIn ${tokenIn} can only be paid by an agent; wallet ${wallet} is not eligible under the token policy.`,
      );
    }
  }
  if (outGated.gated) {
    const allowed = await npm.isAllowedRecipient(tokenOut, recipient);
    if (!allowed) {
      throw new CliError(
        "SWAP_RECIPIENT_NOT_AGENT",
        `Gated tokenOut ${tokenOut} can only be received by an agent; recipient ${recipient} is not eligible under the token policy.`,
      );
    }
  }
}

export interface WalletEligibility {
  address: Address;
  eligible: boolean;
  member: boolean;
  facility: boolean;
  category: number;
  revokedFacility: boolean;
}

/** Read the policy's view of a wallet (doctor/status/preflight). */
export async function walletEligibility(
  sdk: Sdk,
  policyAddress: Address,
  wallet: Address,
): Promise<WalletEligibility> {
  const policy = sdk.registries.transferPolicy(policyAddress);
  const [eligible, member, facility, category, revokedFacility] = await Promise.all([
    policy.isEligible(wallet),
    policy.isMember(wallet),
    policy.isFacility(wallet),
    policy.categoryOf(wallet),
    policy.isRevokedFacility(wallet),
  ]);
  return {
    address: getAddress(wallet),
    eligible,
    member,
    facility,
    category,
    revokedFacility,
  };
}
