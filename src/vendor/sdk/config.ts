import { defineChain, getAddress, zeroAddress, type Address, type Chain, type Transport } from "viem";

import { SdkConfigError } from "./errors.js";

/** Address-book keys understood by the SDK. All are optional at construction. */
export const ADDRESS_KEYS = [
  "tokenFactory",
  "assetRegistry",
  "quoteAssetRegistry",
  "venueRegistry",
  "policyRegistry",
  "facilityFactory",
  "protocolTreasury",
  "gatedPoolFactory",
  "canonicalFactory",
  "positionManager",
  "swapRouter",
  "quoter",
] as const;

export type AddressKey = (typeof ADDRESS_KEYS)[number];
export type ContractAddresses = Partial<Record<AddressKey, Address>>;

/**
 * Generic SDK configuration. The SDK ships no addresses: every chain, RPC and
 * contract address is supplied by the caller.
 */
export interface SdkConfig {
  /** EVM chain id. For local anvil this is usually 31337. */
  chainId: number;
  /** HTTP(S) RPC endpoint. */
  rpcUrl: string;
  /**
   * Optional viem chain definition (for correct native currency, multicall,
   * explorer links). Must match `chainId`. A minimal chain is derived otherwise.
   */
  chain?: Chain;
  /** Contract addresses for this deployment. Missing entries fail on use. */
  addresses?: ContractAddresses;
  /** viem polling interval for indexer watch mode, in milliseconds. */
  pollingInterval?: number;
  /** Optional custom viem transport (e.g. fallback or a test transport). */
  transport?: Transport;
}

export interface ResolvedSdkConfig {
  chainId: number;
  rpcUrl: string;
  chain: Chain;
  addresses: Readonly<ContractAddresses>;
  pollingInterval?: number;
  transport?: Transport;
}

/** Build a minimal viem chain definition from a chain id and RPC URL. */
export function createChain(chainId: number, rpcUrl: string, name?: string): Chain {
  return defineChain({
    id: chainId,
    name: name ?? `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

function normalizeAddresses(input: ContractAddresses | undefined): Readonly<ContractAddresses> {
  const output: ContractAddresses = {};
  if (input === undefined) return output;

  const known = new Set<string>(ADDRESS_KEYS);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      throw new SdkConfigError(`Unknown address book key "${key}". Known keys: ${ADDRESS_KEYS.join(", ")}.`);
    }
  }

  for (const key of ADDRESS_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    let normalized: Address;
    try {
      normalized = getAddress(value);
    } catch (error) {
      throw new SdkConfigError(`Invalid address for "${key}": ${value}`, { cause: error });
    }
    if (normalized === zeroAddress) {
      throw new SdkConfigError(`Address for "${key}" must not be the zero address.`);
    }
    output[key] = normalized;
  }
  return output;
}

/** Validate and normalize caller configuration. No network calls are made. */
export function resolveSdkConfig(config: SdkConfig): ResolvedSdkConfig {
  if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) {
    throw new SdkConfigError(`chainId must be a positive safe integer, got ${String(config.chainId)}.`);
  }
  if (typeof config.rpcUrl !== "string" || config.rpcUrl.trim() === "") {
    throw new SdkConfigError("rpcUrl is required.");
  }
  try {
    new URL(config.rpcUrl);
  } catch (error) {
    throw new SdkConfigError(`rpcUrl is not a valid URL: ${config.rpcUrl}`, { cause: error });
  }

  const chain = config.chain ?? createChain(config.chainId, config.rpcUrl);
  if (chain.id !== config.chainId) {
    throw new SdkConfigError(`chain.id (${chain.id}) does not match chainId (${config.chainId}).`);
  }

  if (config.pollingInterval !== undefined) {
    if (!Number.isSafeInteger(config.pollingInterval) || config.pollingInterval < 0) {
      throw new SdkConfigError("pollingInterval must be a non-negative integer in milliseconds.");
    }
  }

  return {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    chain,
    addresses: normalizeAddresses(config.addresses),
    ...(config.pollingInterval === undefined ? {} : { pollingInterval: config.pollingInterval }),
    ...(config.transport === undefined ? {} : { transport: config.transport }),
  };
}
