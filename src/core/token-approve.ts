import { buildErc20ApproveCall } from "../calldata.js";
import { CliError } from "../errors.js";
import { formatTokenAmount, parseAddress, parseAmount } from "../lib/parse.js";
import { sameAddress } from "../lib/ordering.js";
import { previewCallAndRecord, previewWarnings } from "../preview.js";
import type { Runtime } from "../runtime.js";
import { loadWalletForPreview } from "../wallet.js";
import { baseResult, erc20Meta, type CommandResult } from "./common.js";

export interface TokenApproveOptions {
  token: string;
  spender: string;
  amount: string;
}

/**
 * Build and PREVIEW an exact ERC-20 approval (or revocation with amount 0)
 * through the Binance Agentic Wallet. No execution and no local signing.
 */
export async function runTokenApprove(runtime: Runtime, options: TokenApproveOptions): Promise<CommandResult> {
  const { sdk, deployment } = runtime;
  const token = parseAddress(options.token, "--token");
  const spender = parseAddress(options.spender, "--spender");
  if (sameAddress(token, spender)) {
    throw new CliError("INVALID_SPENDER", "--spender must differ from --token.");
  }

  const wallet = await loadWalletForPreview(runtime.baw);
  const meta = await erc20Meta(sdk, token);
  const amount = parseAmount(options.amount, meta.decimals, "--amount");
  const currentAllowance = await sdk.tokens.at(token).allowance(wallet.address, spender);

  const call = buildErc20ApproveCall(token, spender, amount);
  const prepared = await previewCallAndRecord(runtime, wallet.address, call);

  const warnings = previewWarnings(prepared.preview);
  if (sameAddress(token, deployment.usdt) && currentAllowance > 0n && amount > 0n) {
    warnings.push(
      "USDT-style token with a non-zero current allowance may require resetting to 0 first. Preview --amount 0, execute it, then preview the new allowance. LP/swap preview plans this reset automatically.",
    );
  }
  if (amount > 0n && currentAllowance >= amount) {
    warnings.push("The current allowance already covers the requested amount; this approval may be unnecessary.");
  }

  return {
    ...baseResult(runtime, "token approve"),
    previewOnly: true,
    executed: false,
    wallet: {
      address: wallet.address,
      status: wallet.status,
      devMode: wallet.devModeEnabled,
      source: "binance-agentic-wallet",
    },
    approval: {
      token,
      symbol: meta.symbol,
      decimals: meta.decimals,
      spender,
      amount: amount.toString(),
      amountHuman: formatTokenAmount(amount, meta.decimals),
      currentAllowance: currentAllowance.toString(),
      currentAllowanceHuman: formatTokenAmount(currentAllowance, meta.decimals),
      isRevoke: amount === 0n,
    },
    call: prepared.call,
    preview: prepared.preview,
    next: {
      command: prepared.preview.nextCommand,
      note: "Preview only. Review the parsed transaction and risks, then execute separately if the new allowance is intended.",
    },
    warnings,
  };
}
