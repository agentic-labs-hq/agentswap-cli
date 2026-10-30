import { ADDRESS_KEYS } from "../vendor/sdk/index.js";

import { CliError } from "../errors.js";
import type { Runtime } from "../runtime.js";
import { baseResult, gwei, shortError, type Check, type CommandResult } from "./common.js";
import { walletEligibility } from "./preflight.js";
import { readProtocolSnapshot, snapshotChecks, type ProtocolSnapshot } from "./snapshot.js";
import { checkAgenticWallet } from "./wallet-checks.js";

interface CoreContractCheck {
  key: string;
  address: string;
  hasCode: boolean;
  codeSize: number;
  error?: string;
}

/**
 * Read-only deployment + Binance Agentic Wallet health check. Never previews,
 * signs, or sends. Requires `baw wallet status` to be reachable; if it is not,
 * the command returns a structured BAW_UNAVAILABLE error.
 */
export async function runDoctor(runtime: Runtime): Promise<CommandResult> {
  const { sdk, deployment, baw } = runtime;
  const warnings: string[] = [];
  const checks: Check[] = [];

  const chainId = await sdk.publicClient.getChainId();
  if (chainId !== deployment.chainId) {
    throw new CliError(
      "CHAIN_MISMATCH",
      `RPC reports chain ${chainId}, but deployments/${deployment.chainId}.json is for chain ${deployment.chainId}. Refusing to continue.`,
    );
  }
  checks.push({ name: `chain id ${deployment.chainId}`, status: "ok" });

  const [blockNumber, gasPrice] = await Promise.all([
    sdk.publicClient.getBlockNumber({ cacheTime: 0 }),
    sdk.publicClient.getGasPrice(),
  ]);

  const wallet = await checkAgenticWallet(baw, {
    eligibility: (address) => walletEligibility(sdk, deployment.policy, address),
    bnbBalance: (address) => sdk.publicClient.getBalance({ address }),
  });
  checks.push(...wallet.checks);
  warnings.push(...wallet.warnings);

  const coreSpecs: Array<{ key: string; address: `0x${string}` }> = [
    ...ADDRESS_KEYS.map((key) => ({ key, address: deployment.addresses[key]! })),
    { key: "policy", address: deployment.policy },
    { key: "identityAdapter", address: deployment.identityAdapter },
    { key: "agentIdRegistry", address: deployment.agentIdRegistry },
    ...(deployment.identityRegistry === undefined
      ? []
      : [{ key: "identityRegistry", address: deployment.identityRegistry }]),
    { key: "nftDescriptor", address: deployment.nftDescriptor },
    { key: "positionDescriptor", address: deployment.positionDescriptor },
    { key: "wbnb", address: deployment.wbnb },
    { key: "usdt", address: deployment.usdt },
  ];

  const coreContracts: CoreContractCheck[] = await Promise.all(
    coreSpecs.map(async (spec) => {
      try {
        const code = await sdk.publicClient.getCode({ address: spec.address });
        const size = code === undefined || code === "0x" ? 0 : (code.length - 2) / 2;
        return { key: spec.key, address: spec.address, hasCode: size > 0, codeSize: size };
      } catch (error) {
        return { key: spec.key, address: spec.address, hasCode: false, codeSize: 0, error: shortError(error) };
      }
    }),
  );
  const missingCode = coreContracts.filter((item) => !item.hasCode);
  checks.push(
    missingCode.length === 0
      ? { name: "core contract code", status: "ok", detail: `${coreContracts.length} addresses` }
      : {
          name: "core contract code",
          status: "fail",
          detail: `no code at: ${missingCode.map((item) => item.key).join(", ")}`,
        },
  );

  let snapshot: ProtocolSnapshot | null = null;
  try {
    snapshot = await readProtocolSnapshot(sdk, deployment);
    checks.push(...snapshotChecks(snapshot));
    warnings.push(...snapshot.warnings);
  } catch (error) {
    checks.push({ name: "protocol reads", status: "fail", detail: shortError(error) });
    warnings.push(`Protocol state could not be fully read: ${shortError(error)}`);
  }

  const uniqueWarnings = [...new Set(warnings)];
  const ok = checks.every((check) => check.status !== "fail");

  return {
    ...baseResult(runtime, "doctor"),
    ok,
    blockNumber: blockNumber.toString(),
    gasPriceWei: gasPrice.toString(),
    gasPriceGwei: gwei(gasPrice),
    deployment: {
      name: deployment.name,
      status: deployment.status,
      startBlock: deployment.startBlock ?? null,
      governance: deployment.governance ?? null,
      policy: deployment.policy,
      quoteTokens: deployment.quoteTokens,
    },
    checks,
    warnings: uniqueWarnings,
    coreContracts,
    tokenFactory: snapshot?.tokenFactory ?? null,
    quoteAssets: snapshot?.quoteAssets ?? null,
    policy: snapshot?.policy ?? null,
    poolFactory: snapshot?.poolFactory ?? null,
    baw: wallet,
  };
}
