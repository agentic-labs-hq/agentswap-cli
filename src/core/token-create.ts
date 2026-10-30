import { buildTokenCreateCall } from "../calldata.js";
import {
  formatTokenAmount,
  parseAddress,
  parsePositiveAmount,
  parseRecipients,
  splitSupply,
} from "../lib/parse.js";
import { validateMetadataUri, validateRecipientCount, validateTokenName, validateTokenSymbol } from "../lib/validate.js";
import { previewCallAndRecord, previewWarnings } from "../preview.js";
import type { Runtime } from "../runtime.js";
import { loadWalletForPreview } from "../wallet.js";
import { baseResult, type CommandResult } from "./common.js";
import { assertInitialRecipientsEligible, resolvePolicy } from "./preflight.js";

export interface TokenCreateOptions {
  name: string;
  symbol: string;
  supply: string;
  recipients: string[];
  metadataUri: string;
  policy?: string;
}

/**
 * Build and PREVIEW a gated token creation through the Binance Agentic Wallet.
 * Never executes; the returned requestId must be passed to `agentswap tx execute`
 * separately, with confirmation. `baw` performs the external signing.
 */
export async function runTokenCreate(runtime: Runtime, options: TokenCreateOptions): Promise<CommandResult> {
  const { sdk, deployment } = runtime;

  validateTokenName(options.name);
  validateTokenSymbol(options.symbol);
  validateMetadataUri(options.metadataUri);
  const supply = parsePositiveAmount(options.supply, 18, "--supply");
  const recipients = parseRecipients(options.recipients);
  const amounts = splitSupply(supply, recipients.length);
  const explicitPolicy = options.policy === undefined ? undefined : parseAddress(options.policy, "--policy");

  const wallet = await loadWalletForPreview(runtime.baw);
  const [policy, maxRecipients] = await Promise.all([
    resolvePolicy(sdk, explicitPolicy),
    sdk.tokens.maxRecipients(),
  ]);
  validateRecipientCount(recipients.length, maxRecipients);
  await assertInitialRecipientsEligible(sdk, policy.address, recipients);

  const call = buildTokenCreateCall({
    factory: deployment.addresses.tokenFactory!,
    name: options.name,
    symbol: options.symbol,
    policy: policy.address,
    recipients,
    amounts,
    metadataURI: options.metadataUri,
  });

  const prepared = await previewCallAndRecord(runtime, wallet.address, call);

  return {
    ...baseResult(runtime, "token create"),
    previewOnly: true,
    executed: false,
    wallet: {
      address: wallet.address,
      status: wallet.status,
      devMode: wallet.devModeEnabled,
      source: "binance-agentic-wallet",
    },
    token: {
      address: null,
      name: options.name,
      symbol: options.symbol,
      decimals: 18,
      totalSupply: supply.toString(),
      totalSupplyHuman: formatTokenAmount(supply, 18),
      metadataURI: options.metadataUri,
      policy: policy.address,
      policySource: policy.source,
      creator: wallet.address,
      factory: deployment.addresses.tokenFactory,
    },
    recipients: recipients.map((address, index) => ({
      address,
      amount: amounts[index]!.toString(),
      amountHuman: formatTokenAmount(amounts[index]!, 18),
    })),
    call: prepared.call,
    preview: prepared.preview,
    next: {
      command: prepared.preview.nextCommand,
      note: "Preview only. Execute only after reviewing parsedTx/simulation/risks and confirming the action; Binance App confirmation may be required.",
    },
    warnings: previewWarnings(prepared.preview),
  };
}
