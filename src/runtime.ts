import { createChain, createSdk, type Sdk } from "./vendor/sdk/index.js";
import { bsc } from "viem/chains";
import type { Chain } from "viem";

import { BawClient } from "./baw.js";
import { loadDeployment, type Deployment } from "./deployment.js";
import { createStateStore, type StateStore } from "./state.js";
import { CliError } from "./errors.js";

export const DEFAULT_RPC_URL = "https://bsc-dataseed.bnbchain.org";

/** Read-only SDK + deployment + BAW client. There is deliberately no signer. */
export interface Runtime {
  sdk: Sdk;
  deployment: Deployment;
  rpcUrl: string;
  /** Host only: never print the full URL because RPC providers embed API keys. */
  rpcHost: string;
  baw: BawClient;
  /** Local preview/execution journal; production uses the per-user state dir. */
  stateStore?: StateStore;
}

export interface RuntimeOptions {
  deployment?: Deployment;
  env?: NodeJS.ProcessEnv;
  /** Injectable BAW client for tests. */
  baw?: BawClient;
  /** Injectable state store for tests. */
  stateStore?: StateStore;
}

/** `AGENTSWAP_RPC_URL` when set, otherwise the deployment default, otherwise BSC public. */
export function resolveRpcUrl(deployment: Deployment, env: NodeJS.ProcessEnv = process.env): string {
  const value = env.AGENTSWAP_RPC_URL?.trim();
  const rpcUrl = value === undefined || value === "" ? deployment.rpcUrl || DEFAULT_RPC_URL : value;
  try {
    const url = new URL(rpcUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    throw new CliError("RPC_INVALID", "AGENTSWAP_RPC_URL must be a valid http(s) URL.");
  }
  return rpcUrl;
}

/** Host for display; strips credentials, paths, and query parameters. */
export function rpcHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return "invalid-rpc-url";
  }
}

/**
 * Build the read-only SDK from the address book and environment. The SDK is
 * intentionally constructed without a local account: all signing is delegated
 * to the Binance Agentic Wallet via `baw`.
 */
export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const env = options.env ?? process.env;
  const deployment = options.deployment ?? loadDeployment();
  const rpcUrl = resolveRpcUrl(deployment, env);
  const chain: Chain = deployment.chainId === 56 ? bsc : createChain(deployment.chainId, rpcUrl, deployment.network);
  const sdk = createSdk({ chainId: deployment.chainId, rpcUrl, chain, addresses: deployment.addresses });

  return {
    sdk,
    deployment,
    rpcUrl,
    rpcHost: rpcHost(rpcUrl),
    baw: options.baw ?? new BawClient(),
    stateStore: options.stateStore ?? createStateStore(env),
  };
}
