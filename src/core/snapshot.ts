import { type Sdk } from "../vendor/sdk/index.js";
import { zeroAddress, type Address } from "viem";

import { sameAddress } from "../lib/ordering.js";
import type { Deployment } from "../deployment.js";
import { addressListEquals, erc20Meta, missingAddresses, shortError, type Check } from "./common.js";

export interface QuoteAssetInfo {
  address: Address;
  symbol: string | null;
  decimals: number | null;
}

export interface ProtocolSnapshot {
  tokenFactory: {
    address: Address;
    policyRegistry: Address;
    assetRegistry: Address;
    facilityRegistry: Address;
    maxRecipients: string;
    registriesMatch: boolean;
  };
  quoteAssets: QuoteAssetInfo[];
  quoteAssetsMatch: boolean;
  quoteAssetsMissing: Address[];
  quoteAssetsExtra: Address[];
  policy: {
    addressBook: Address;
    current: Address;
    version: string | null;
    allowed: boolean;
    matchesAddressBook: boolean;
  };
  poolFactory: {
    address: Address;
    canonicalFactory: Address;
    canonicalFactoryMatches: boolean;
    canonicalOwner: Address | null;
    canonicalOwnerIsGated: boolean;
    governance: Address;
    pendingGovernance: Address;
    allowedFees: Array<{ fee: number; allowed: boolean }>;
  };
  warnings: string[];
}

export const DEFAULT_FEE_TIERS = [100, 500, 3000, 10000] as const;

/**
 * Read the shared protocol state used by doctor/status. Every check is
 * read-only; the caller decides which deviations are fatal vs warnings.
 */
export async function readProtocolSnapshot(sdk: Sdk, deployment: Deployment): Promise<ProtocolSnapshot> {
  const warnings: string[] = [];
  const tokenFactoryAddress = deployment.addresses.tokenFactory!;
  const [policyRegistry, assetRegistry, facilityRegistry, maxRecipients] = await Promise.all([
    sdk.tokens.policyRegistry(),
    sdk.tokens.assetRegistry(),
    sdk.tokens.facilityRegistry(),
    sdk.tokens.maxRecipients(),
  ]);

  const registriesMatch =
    sameAddress(policyRegistry, deployment.addresses.policyRegistry!) &&
    sameAddress(assetRegistry, deployment.addresses.assetRegistry!) &&
    sameAddress(facilityRegistry, deployment.addresses.venueRegistry!);
  if (!registriesMatch) {
    warnings.push(
      `Token factory registries differ from the address book (policyRegistry=${policyRegistry}, assetRegistry=${assetRegistry}, facilityRegistry=${facilityRegistry}).`,
    );
  }

  const quoteAssetRegistry = sdk.registries.quoteAssetRegistry();
  const onChainQuoteAssets = await quoteAssetRegistry.quoteAssets();
  const quoteAssets = await Promise.all(
    onChainQuoteAssets.map(async (address): Promise<QuoteAssetInfo> => {
      try {
        const meta = await erc20Meta(sdk, address);
        return { address, symbol: meta.symbol, decimals: meta.decimals };
      } catch (error) {
        warnings.push(`Could not read quote asset metadata for ${address}: ${shortError(error)}`);
        return { address, symbol: null, decimals: null };
      }
    }),
  );
  const quoteAssetsMatch = addressListEquals(onChainQuoteAssets, deployment.quoteTokens);
  const quoteAssetsMissing = missingAddresses(deployment.quoteTokens, onChainQuoteAssets);
  const quoteAssetsExtra = missingAddresses(onChainQuoteAssets, deployment.quoteTokens);
  if (!quoteAssetsMatch) {
    warnings.push(
      `On-chain quote assets differ from deployments/${deployment.chainId}.json (missing: ${
        quoteAssetsMissing.join(", ") || "none"
      }; extra: ${quoteAssetsExtra.join(", ") || "none"}).`,
    );
  }

  const policyRegistryActions = sdk.registries.policyRegistry();
  const currentPolicy = await policyRegistryActions.currentPolicy();
  let policyVersion: bigint | null = null;
  if (currentPolicy !== zeroAddress) {
    try {
      policyVersion = await policyRegistryActions.policyVersion(currentPolicy);
    } catch {
      policyVersion = null;
    }
  }
  const policyAllowed =
    currentPolicy === zeroAddress ? false : await policyRegistryActions.isPolicyAllowed(currentPolicy);
  const policyMatchesAddressBook = sameAddress(currentPolicy, deployment.policy);
  if (!policyMatchesAddressBook) {
    warnings.push(
      `Policy registry currentPolicy is ${currentPolicy} but the address book policy is ${deployment.policy}.`,
    );
  }
  if (!policyAllowed) {
    warnings.push(`Policy registry currentPolicy ${currentPolicy} is not registered/allowed.`);
  }

  const poolFactory = sdk.dex.poolFactory();
  const [canonicalFactory, governance, pendingGovernance] = await Promise.all([
    poolFactory.canonicalFactory(),
    poolFactory.governance(),
    poolFactory.pendingGovernance(),
  ]);
  const canonicalFactoryMatches = sameAddress(canonicalFactory, deployment.addresses.canonicalFactory!);
  if (!canonicalFactoryMatches) {
    warnings.push(
      `Pool factory canonicalFactory is ${canonicalFactory} but the address book canonicalFactory is ${deployment.addresses.canonicalFactory}.`,
    );
  }

  let canonicalOwner: Address | null = null;
  try {
    canonicalOwner = await sdk.dex.canonicalFactory(canonicalFactory).owner();
  } catch (error) {
    warnings.push(`Could not read canonical factory owner: ${shortError(error)}`);
  }
  const canonicalOwnerIsGated =
    canonicalOwner !== null && sameAddress(canonicalOwner, deployment.addresses.gatedPoolFactory!);
  if (canonicalOwner !== null && !canonicalOwnerIsGated) {
    warnings.push(
      `Canonical V3 factory owner is ${canonicalOwner}, not the gated pool factory ${deployment.addresses.gatedPoolFactory}.`,
    );
  }

  if (pendingGovernance !== zeroAddress) {
    warnings.push(`Pool factory has pending governance ${pendingGovernance} (governance handover not accepted).`);
  }
  if (deployment.governance !== undefined && !sameAddress(governance, deployment.governance)) {
    warnings.push(`Pool factory governance is ${governance}, not the governance Safe from the address book ${deployment.governance}.`);
  }

  const allowedFees = await Promise.all(
    DEFAULT_FEE_TIERS.map(async (fee) => ({ fee, allowed: await poolFactory.isAllowedFee(fee) })),
  );

  return {
    tokenFactory: {
      address: tokenFactoryAddress,
      policyRegistry,
      assetRegistry,
      facilityRegistry,
      maxRecipients: maxRecipients.toString(),
      registriesMatch,
    },
    quoteAssets,
    quoteAssetsMatch,
    quoteAssetsMissing,
    quoteAssetsExtra,
    policy: {
      addressBook: deployment.policy,
      current: currentPolicy,
      version: policyVersion === null ? null : policyVersion.toString(),
      allowed: policyAllowed,
      matchesAddressBook: policyMatchesAddressBook,
    },
    poolFactory: {
      address: deployment.addresses.gatedPoolFactory!,
      canonicalFactory,
      canonicalFactoryMatches,
      canonicalOwner,
      canonicalOwnerIsGated,
      governance,
      pendingGovernance,
      allowedFees,
    },
    warnings,
  };
}

export function snapshotChecks(snapshot: ProtocolSnapshot): Check[] {
  return [
    {
      name: "token factory registries",
      status: snapshot.tokenFactory.registriesMatch ? "ok" : "fail",
      ...(snapshot.tokenFactory.registriesMatch
        ? {}
        : { detail: "factory policy/asset/venue registry addresses do not match the address book" }),
    },
    {
      name: "quote assets",
      status: snapshot.quoteAssetsMatch ? "ok" : "warn",
      ...(snapshot.quoteAssetsMatch
        ? {}
        : { detail: `missing: ${snapshot.quoteAssetsMissing.join(", ") || "none"}; extra: ${snapshot.quoteAssetsExtra.join(", ") || "none"}` }),
    },
    {
      name: "current policy allowed",
      status: snapshot.policy.allowed ? "ok" : "fail",
      ...(snapshot.policy.allowed ? {} : { detail: `current policy ${snapshot.policy.current} is not allowed` }),
    },
    {
      name: "policy matches address book",
      status: snapshot.policy.matchesAddressBook ? "ok" : "warn",
      ...(snapshot.policy.matchesAddressBook
        ? {}
        : { detail: `current ${snapshot.policy.current} != address book ${snapshot.policy.addressBook}` }),
    },
    {
      name: "pool factory canonical factory",
      status: snapshot.poolFactory.canonicalFactoryMatches ? "ok" : "fail",
      ...(snapshot.poolFactory.canonicalFactoryMatches
        ? {}
        : { detail: `canonicalFactory ${snapshot.poolFactory.canonicalFactory} does not match the address book` }),
    },
    {
      name: "canonical factory owner",
      status: snapshot.poolFactory.canonicalOwnerIsGated ? "ok" : "fail",
      ...(snapshot.poolFactory.canonicalOwnerIsGated
        ? {}
        : { detail: `owner ${snapshot.poolFactory.canonicalOwner ?? "unknown"} != gated pool factory` }),
    },
    {
      name: "pool factory governance",
      status: snapshot.poolFactory.pendingGovernance === zeroAddress ? "ok" : "warn",
      ...(snapshot.poolFactory.pendingGovernance === zeroAddress
        ? {}
        : { detail: `pending governance ${snapshot.poolFactory.pendingGovernance}` }),
    },
  ];
}
