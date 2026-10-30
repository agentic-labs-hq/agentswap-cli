import { CliError } from "../errors.js";
import type { Runtime } from "../runtime.js";
import { baseResult, gwei, shortError, type CommandResult } from "./common.js";
import { walletEligibility } from "./preflight.js";
import { readProtocolSnapshot, type ProtocolSnapshot } from "./snapshot.js";
import { checkAgenticWallet } from "./wallet-checks.js";

/**
 * Read-only snapshot: BSC head, address-book factories, current policy, and the
 * Binance Agentic Wallet state. BAW unavailability is reported in the result
 * (with `healthy:false`) rather than aborting the RPC snapshot.
 */
export async function runStatus(runtime: Runtime): Promise<CommandResult> {
  const { sdk, deployment, baw } = runtime;
  const warnings: string[] = [];

  const chainId = await sdk.publicClient.getChainId();
  if (chainId !== deployment.chainId) {
    throw new CliError(
      "CHAIN_MISMATCH",
      `RPC reports chain ${chainId}, but deployments/${deployment.chainId}.json is for chain ${deployment.chainId}.`,
    );
  }

  const [blockNumber, gasPrice] = await Promise.all([
    sdk.publicClient.getBlockNumber({ cacheTime: 0 }),
    sdk.publicClient.getGasPrice(),
  ]);

  const wallet = await checkAgenticWallet(baw, {
    tolerant: true,
    eligibility: (address) => walletEligibility(sdk, deployment.policy, address),
    bnbBalance: (address) => sdk.publicClient.getBalance({ address }),
  });
  warnings.push(...wallet.warnings);

  let snapshot: ProtocolSnapshot | null = null;
  try {
    snapshot = await readProtocolSnapshot(sdk, deployment);
    warnings.push(...snapshot.warnings);
  } catch (error) {
    warnings.push(`Protocol state could not be fully read: ${shortError(error)}`);
  }

  const protocolHealthy =
    snapshot !== null &&
    snapshot.tokenFactory.registriesMatch &&
    snapshot.policy.allowed &&
    snapshot.poolFactory.canonicalFactoryMatches &&
    snapshot.poolFactory.canonicalOwnerIsGated &&
    snapshot.quoteAssetsMatch;

  const walletHealthy =
    wallet.available &&
    wallet.status === "CONNECTED" &&
    wallet.address !== null &&
    wallet.devMode.enabled === true &&
    wallet.agentId?.eligible === true;

  return {
    ...baseResult(runtime, "status"),
    healthy: protocolHealthy && walletHealthy,
    blockNumber: blockNumber.toString(),
    gasPriceWei: gasPrice.toString(),
    gasPriceGwei: gwei(gasPrice),
    deployment: {
      name: deployment.name,
      status: deployment.status,
      startBlock: deployment.startBlock ?? null,
      governance: deployment.governance ?? null,
    },
    tokenFactory: snapshot?.tokenFactory ?? null,
    quoteAssets: snapshot?.quoteAssets ?? null,
    policy: snapshot?.policy ?? null,
    poolFactory: snapshot?.poolFactory ?? null,
    baw: wallet,
    warnings: [...new Set(warnings)],
  };
}
