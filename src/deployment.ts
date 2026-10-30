import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ADDRESS_KEYS, type AddressKey, type ContractAddresses } from "./vendor/sdk/index.js";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";

import { CliError } from "./errors.js";

/** Parsed and validated address book for one deployment. */
export interface Deployment {
  chainId: number;
  network: string;
  name: string;
  status: string;
  startBlock?: number;
  rpcUrl: string;
  governance?: Address;
  deployer?: Address;
  addresses: ContractAddresses;
  /** Immutable Agent ID transfer policy used by the branded deployment. */
  policy: Address;
  identityAdapter: Address;
  agentIdRegistry: Address;
  identityRegistry?: Address;
  nftDescriptor: Address;
  positionDescriptor: Address;
  quoteTokens: Address[];
  wbnb: Address;
  usdt: Address;
  /** Original JSON object, useful for diagnostics without re-reading the file. */
  raw: Record<string, unknown>;
}

/** Default address book shipped with the package (`deployments/56.json`). */
export const DEFAULT_DEPLOYMENT_PATH = fileURLToPath(new URL("../deployments/56.json", import.meta.url));

const REQUIRED_EXTRA_KEYS = [
  "policy",
  "identityAdapter",
  "agentIdRegistry",
  "nftDescriptor",
  "positionDescriptor",
  "wbnb",
  "usdt",
] as const;

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("DEPLOYMENT_INVALID", `${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function parseChainId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new CliError("DEPLOYMENT_INVALID", "deployment.chainId must be a positive safe integer.");
  }
  return value;
}

function parseString(value: unknown, key: string, required = true): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new CliError("DEPLOYMENT_INVALID", `deployment.${key} is required.`);
    return undefined;
  }
  if (typeof value !== "string") {
    throw new CliError("DEPLOYMENT_INVALID", `deployment.${key} must be a string.`);
  }
  return value;
}

function parseAddress(value: unknown, key: string): Address {
  const raw = parseString(value, key);
  if (raw === undefined || !isAddress(raw)) {
    throw new CliError("DEPLOYMENT_INVALID", `deployment.${key} is not a valid EVM address.`);
  }
  let address: Address;
  try {
    address = getAddress(raw);
  } catch (error) {
    throw new CliError("DEPLOYMENT_INVALID", `deployment.${key} has an invalid EIP-55 checksum.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (address === zeroAddress) {
    throw new CliError("DEPLOYMENT_INVALID", `deployment.${key} must not be the zero address.`);
  }
  return address;
}

function parseOptionalAddress(value: unknown, key: string): Address | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parseAddress(value, key);
}

/**
 * Load and validate a deployment address book. No network calls are made.
 * Addresses are EIP-55 normalized; every SDK address key is required so that
 * a typo in the JSON fails at startup instead of at transaction time.
 */
export function loadDeployment(path: string = DEFAULT_DEPLOYMENT_PATH): Deployment {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new CliError("DEPLOYMENT_UNREADABLE", `Cannot read deployment address book at ${path}.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliError("DEPLOYMENT_INVALID", "Deployment address book is not valid JSON.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const raw = requireObject(parsed, "deployment");

  if (raw.chainId === undefined) {
    throw new CliError("DEPLOYMENT_INVALID", "deployment.chainId is required.");
  }
  const chainId = parseChainId(raw.chainId);
  const network = parseString(raw.network, "network") ?? `chain-${chainId}`;

  const addresses: ContractAddresses = {};
  for (const key of ADDRESS_KEYS) {
    addresses[key] = parseAddress(raw[key], key);
  }

  for (const key of REQUIRED_EXTRA_KEYS) {
    if (raw[key] === undefined) {
      throw new CliError("DEPLOYMENT_INVALID", `deployment.${key} is required.`);
    }
  }

  const quoteTokensRaw = raw.quoteTokens;
  if (!Array.isArray(quoteTokensRaw) || quoteTokensRaw.length === 0) {
    throw new CliError("DEPLOYMENT_INVALID", "deployment.quoteTokens must be a non-empty array.");
  }
  const quoteTokens = quoteTokensRaw.map((entry, index) => parseAddress(entry, `quoteTokens[${index}]`));
  const seen = new Set<string>();
  for (const token of quoteTokens) {
    const lower = token.toLowerCase();
    if (seen.has(lower)) {
      throw new CliError("DEPLOYMENT_INVALID", `deployment.quoteTokens contains duplicate ${token}.`);
    }
    seen.add(lower);
  }

  const wbnb = parseAddress(raw.wbnb, "wbnb");
  const usdt = parseAddress(raw.usdt, "usdt");
  for (const [label, address] of [
    ["wbnb", wbnb],
    ["usdt", usdt],
  ] as const) {
    if (!seen.has(address.toLowerCase())) {
      throw new CliError("DEPLOYMENT_INVALID", `deployment.${label} must also be listed in quoteTokens.`);
    }
  }

  const rpcUrl = parseString(raw.rpcUrl, "rpcUrl", false);
  if (rpcUrl !== undefined) {
    try {
      const url = new URL(rpcUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    } catch {
      throw new CliError("DEPLOYMENT_INVALID", "deployment.rpcUrl must be an http(s) URL.");
    }
  }

  const governance = parseOptionalAddress(raw.governance, "governance");
  const deployer = parseOptionalAddress(raw.deployer, "deployer");
  const identityRegistry = parseOptionalAddress(raw.identityRegistry, "identityRegistry");

  return {
    chainId,
    network,
    name: parseString(raw.name, "name", false) ?? "Agentic Protocol",
    status: parseString(raw.status, "status", false) ?? "unknown",
    ...(typeof raw.startBlock === "number" && Number.isSafeInteger(raw.startBlock) && raw.startBlock > 0
      ? { startBlock: raw.startBlock }
      : {}),
    rpcUrl: rpcUrl ?? "https://bsc-dataseed.bnbchain.org",
    ...(governance === undefined ? {} : { governance }),
    ...(deployer === undefined ? {} : { deployer }),
    addresses,
    policy: parseAddress(raw.policy, "policy"),
    identityAdapter: parseAddress(raw.identityAdapter, "identityAdapter"),
    agentIdRegistry: parseAddress(raw.agentIdRegistry, "agentIdRegistry"),
    ...(identityRegistry === undefined ? {} : { identityRegistry }),
    nftDescriptor: parseAddress(raw.nftDescriptor, "nftDescriptor"),
    positionDescriptor: parseAddress(raw.positionDescriptor, "positionDescriptor"),
    quoteTokens,
    wbnb,
    usdt,
    raw,
  };
}

/** Address for an SDK address-book key; guaranteed present by the loader. */
export function deploymentAddress(deployment: Deployment, key: AddressKey): Address {
  const address = deployment.addresses[key];
  if (address === undefined) {
    throw new CliError("DEPLOYMENT_INVALID", `deployment.${key} is required for this command.`);
  }
  return address;
}
