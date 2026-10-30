import type { ErrorPayload } from "./errors.js";
import { toJsonSafe } from "./json.js";

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (value === undefined || value === null) return "—";
  return String(value);
}

function warningLines(value: unknown): string[] {
  const warnings = arr(value).map(String);
  if (warnings.length === 0) return [];
  return ["", "Warnings:", ...warnings.map((warning) => `  ! ${warning}`)];
}

function checkLines(value: unknown): string[] {
  return arr(value)
    .map(obj)
    .map((check) => {
      const status = text(check.status);
      const label = status === "ok" ? "OK  " : status === "warn" ? "WARN" : "FAIL";
      return `  ${label} ${text(check.name)}${check.detail === undefined ? "" : ` — ${text(check.detail)}`}`;
    });
}

function formatExpiry(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function renderBaw(value: unknown): string[] {
  const baw = obj(value);
  if (baw.available === false || (baw.error !== null && baw.error !== undefined)) {
    const error = obj(baw.error);
    return [
      `BAW: unavailable${error.code === undefined ? "" : ` (${text(error.code)})`}${error.message === undefined ? "" : ` — ${text(error.message)}`}`,
    ];
  }
  const identity = [
    baw.version === undefined || baw.version === null ? null : `version=${text(baw.version)}`,
    baw.status === undefined || baw.status === null ? null : `status=${text(baw.status)}`,
    baw.address === undefined || baw.address === null ? null : `address=${text(baw.address)}`,
  ].filter((item): item is string => item !== null);
  const lines = [`BAW: ${identity.length === 0 ? "not queried" : identity.join(" ")}`];
  const devModeValue = baw.devMode;
  const devModeObject = obj(devModeValue);
  const devModeEnabled =
    typeof devModeValue === "boolean" ? devModeValue : devModeObject.enabled === true;
  const expiresAt = typeof devModeValue === "boolean" ? null : devModeObject.expiresAt;
  lines.push(
    `  Developer Mode: ${devModeEnabled ? "enabled" : "disabled"}${
      expiresAt === null || expiresAt === undefined ? "" : ` (expires ${formatExpiry(expiresAt)})`
    }`,
  );
  const agentId = obj(baw.agentId);
  if (Object.keys(agentId).length > 0) {
    lines.push(`  Agent ID eligible: ${text(agentId.eligible)} (member=${text(agentId.member)} facility=${text(agentId.facility)})`);
  }
  if (baw.bnbBalance !== null && baw.bnbBalance !== undefined) {
    lines.push(`  BNB balance: ${text(baw.bnbBalance)}`);
  }
  if (baw.txLock !== null && baw.txLock !== undefined) {
    lines.push(`  tx-lock: ${text(baw.txLock)}`);
  }
  return lines;
}

function renderCall(value: unknown): string[] {
  const call = obj(value);
  if (call.to === undefined) return [];
  return [
    `Call: ${text(call.functionName)} -> ${text(call.to)} (value=${text(call.valueWei ?? call.value)} wei)`,
  ];
}

function renderRisks(value: unknown): string[] {
  const risks = obj(value);
  const lines: string[] = [];
  const details = arr(risks.riskDetails).map(obj);
  if (details.length === 0) lines.push("  (no transaction-level risks reported)");
  for (const risk of details) {
    lines.push(`  [${text(risk.riskType)}] ${text(risk.title)} — ${text(risk.description)}`);
  }
  const addresses = obj(risks.addresses);
  for (const [address, infoValue] of Object.entries(addresses)) {
    const info = obj(infoValue);
    const addressRisks = arr(info.riskDetails).map(obj);
    lines.push(`  Address ${address} riskLevel=${text(info.riskLevel)}`);
    for (const risk of addressRisks) {
      lines.push(`    [${text(risk.riskType)}] ${text(risk.title)} — ${text(risk.description)}`);
    }
  }
  return lines;
}

function renderPreview(value: unknown): string[] {
  const preview = obj(value);
  if (preview.requestId === undefined) return [];
  const lines: string[] = [
    "",
    "Preview (nothing sent):",
    `  Request ID: ${text(preview.requestId)}`,
    `  Expires: ${formatExpiry(preview.expiresAt)}`,
    `  Requires Binance App confirmation: ${preview.requireConfirmation === true ? "YES" : "no"}`,
  ];
  const parsed = obj(preview.parsedTx);
  if (Object.keys(parsed).length > 0) {
    lines.push("  Parsed transaction:");
    for (const [key, item] of Object.entries(parsed)) {
      lines.push(`    ${key}: ${typeof item === "object" ? JSON.stringify(item) : text(item)}`);
    }
  }
  const simulation = obj(preview.simulationResult);
  if (Object.keys(simulation).length > 0) {
    lines.push(
      `  Simulation: code=${text(simulation.simulationCode)} error=${text(simulation.simulationErrorDetail)} balanceChanges=${arr(
        simulation.balanceChanges,
      ).length} allowanceChanges=${arr(simulation.allowanceChanges).length} authorityChanges=${arr(simulation.authorityChanges).length}`,
    );
  }
  lines.push("  Risks:");
  lines.push(...renderRisks(preview.risks));
  lines.push(`  Next: ${text(preview.nextCommand)}`);
  return lines;
}

function renderNeedsApproval(value: unknown): string[] {
  const steps = arr(value).map(obj);
  if (steps.length === 0) return [];
  const lines: string[] = ["", "Needs approval first (previewed, not executed):"];
  steps.forEach((step, index) => {
    const preview = obj(step.preview);
    lines.push(
      `  ${index + 1}. ${step.kind === "reset" ? "RESET allowance to 0" : "APPROVE"} ${text(step.amountHuman)} ${
        step.symbol === null ? "" : text(step.symbol)
      } (${text(step.token)}) -> spender ${text(step.spender)}${step.resetFirst === true ? " [after reset]" : ""}`,
    );
    lines.push(`     reason: ${text(step.reason)}`);
    lines.push(`     requestId: ${text(preview.requestId)}  requires App confirmation: ${preview.requireConfirmation === true ? "YES" : "no"}`);
    lines.push(`     next: ${text(step.nextCommand)}`);
  });
  return lines;
}

function renderDoctor(data: Json): string {
  const lines: string[] = [];
  lines.push(`Agentic Protocol doctor — ${text(data.network)} (chain ${text(data.chainId)})`);
  lines.push(`RPC ${text(data.rpcHost)} | block ${text(data.blockNumber)} | gas ${text(data.gasPriceGwei)} gwei`);
  lines.push(...renderBaw(data.baw));
  lines.push("");
  lines.push("Checks:");
  lines.push(...checkLines(data.checks));
  const quota = obj(obj(data.baw).settings);
  if (quota.sessionExpireTime !== undefined) {
    lines.push(`Session expires: ${text(quota.sessionExpireTime)}`);
  }
  const missing = arr(data.coreContracts).map(obj).filter((item) => item.hasCode === false);
  if (missing.length > 0) {
    lines.push(`Missing code: ${missing.map((item) => `${text(item.key)} (${text(item.address)})`).join(", ")}`);
  }
  const tokenFactory = obj(data.tokenFactory);
  if (tokenFactory.address !== undefined) {
    lines.push("");
    lines.push(`Token factory ${text(tokenFactory.address)} (maxRecipients=${text(tokenFactory.maxRecipients)})`);
  }
  const policy = obj(data.policy);
  if (policy.current !== undefined) {
    lines.push(`Policy: current=${text(policy.current)} allowed=${text(policy.allowed)}`);
  }
  const poolFactory = obj(data.poolFactory);
  if (poolFactory.canonicalOwner !== undefined) {
    lines.push(
      `Pool factory: canonical=${text(poolFactory.canonicalFactory)} owner=${text(poolFactory.canonicalOwner)} gatedOwner=${text(
        poolFactory.canonicalOwnerIsGated,
      )}`,
    );
  }
  lines.push(...warningLines(data.warnings));
  lines.push("");
  lines.push(`Result: ${data.ok === true ? "OK" : "FAILED"}`);
  return lines.join("\n");
}

function renderStatus(data: Json): string {
  const lines: string[] = [];
  lines.push(`Agentic Protocol status — ${text(data.network)} (chain ${text(data.chainId)})`);
  lines.push(`Health: ${data.healthy === true ? "healthy" : "degraded"}`);
  lines.push(`RPC ${text(data.rpcHost)} | block ${text(data.blockNumber)} | gas ${text(data.gasPriceGwei)} gwei`);
  lines.push(...renderBaw(data.baw));
  const policy = obj(data.policy);
  if (policy.current !== undefined) lines.push(`Policy: ${text(policy.current)} (allowed=${text(policy.allowed)})`);
  const poolFactory = obj(data.poolFactory);
  if (poolFactory.canonicalOwner !== undefined) {
    lines.push(`Canonical factory owner: ${text(poolFactory.canonicalOwner)} (gated=${text(poolFactory.canonicalOwnerIsGated)})`);
  }
  const quoteAssets = arr(data.quoteAssets).map(obj);
  if (quoteAssets.length > 0) {
    lines.push(`Quote assets: ${quoteAssets.map((asset) => `${text(asset.symbol)} ${text(asset.address)}`).join(", ")}`);
  }
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderTokenCreate(data: Json): string {
  const token = obj(data.token);
  const lines = [`token create — PREVIEW ONLY (not sent)`];
  lines.push(...renderBaw(data.wallet));
  lines.push(`Name/Symbol: ${text(token.name)} / ${text(token.symbol)} | supply: ${text(token.totalSupplyHuman)} (18 decimals)`);
  lines.push(`Policy: ${text(token.policy)} (${text(token.policySource)}) | creator: ${text(token.creator)}`);
  lines.push(`Metadata: ${text(token.metadataURI)}`);
  lines.push("Recipients:");
  for (const recipient of arr(data.recipients).map(obj)) {
    lines.push(`  ${text(recipient.address)}: ${text(recipient.amountHuman)}`);
  }
  lines.push(...renderCall(data.call));
  lines.push(...renderPreview(data.preview));
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderTokenApprove(data: Json): string {
  const approval = obj(data.approval);
  const lines = ["token approve — PREVIEW ONLY (not sent)"];
  lines.push(...renderBaw(data.wallet));
  lines.push(
    `${approval.isRevoke === true ? "REVOKE" : "APPROVE"} ${text(approval.amountHuman)} ${text(approval.symbol)} (${text(
      approval.token,
    )}) -> ${text(approval.spender)}`,
  );
  lines.push(`Current allowance: ${text(approval.currentAllowanceHuman)}`);
  lines.push(...renderCall(data.call));
  lines.push(...renderPreview(data.preview));
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderPoolCreate(data: Json): string {
  const pool = obj(data.pool);
  const lines = ["dex pool create — PREVIEW ONLY (not sent)"];
  lines.push(...renderBaw(data.wallet));
  lines.push(`Pair: ${text(pool.token0Symbol)} (${text(pool.token0)}) / ${text(pool.token1Symbol)} (${text(pool.token1)})`);
  lines.push(`Fee: ${text(pool.fee)} | tickSpacing: ${text(pool.tickSpacing)} | sqrtPriceX96: ${text(pool.sqrtPriceX96)}`);
  if (pool.price !== null) lines.push(`Price: ${text(pool.price)} ${text(pool.priceDefinition)}`);
  const gated = obj(data.gated);
  lines.push(
    `Gated: token=${text(obj(gated.token).gated)} creator=${text(obj(gated.token).creator)} | quote=${text(
      obj(gated.quote).gated,
    )} creator=${text(obj(gated.quote).creator)}`,
  );
  lines.push(...renderCall(data.call));
  lines.push(...renderPreview(data.preview));
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderLpAdd(data: Json): string {
  const pool = obj(data.pool);
  const position = obj(data.position);
  const lines = [`dex lp add — PREVIEW ONLY (not sent) | status: ${text(data.status)}`];
  lines.push(...renderBaw(data.wallet));
  lines.push(`Pool: ${text(pool.address)} ${text(pool.token0Symbol)}/${text(pool.token1Symbol)} fee=${text(pool.fee)} spacing=${text(pool.tickSpacing)}`);
  lines.push(`Range: ${text(position.tickLower)} .. ${text(position.tickUpper)} (current tick ${text(pool.currentTick)})`);
  lines.push(
    `Amounts: ${text(position.amount0DesiredHuman)} token0 / ${text(position.amount1DesiredHuman)} token1 (min ${text(
      position.amount0Min,
    )} / ${text(position.amount1Min)} raw)`,
  );
  for (const allowance of arr(data.allowances).map(obj)) {
    lines.push(
      `Allowance ${text(allowance.symbol)}: ${text(allowance.currentHuman)} / ${text(allowance.requiredHuman)} sufficient=${text(
        allowance.sufficient,
      )}`,
    );
  }
  lines.push(...renderNeedsApproval(data.needsApproval));
  if (data.preview !== undefined) lines.push(...renderCall(data.call), ...renderPreview(data.preview));
  if (data.status === "needsApproval") {
    const next = obj(data.next);
    lines.push("", `Next: ${text(next.note)}`);
  }
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderLpRemove(data: Json): string {
  const position = obj(data.position);
  const liquidity = obj(data.liquidity);
  const lines = [
    `dex lp remove — PREVIEW ONLY (not sent) | requiresSequentialExecution: ${text(data.requiresSequentialExecution)}`,
  ];
  lines.push(...renderBaw(data.wallet));
  lines.push(
    `Position #${text(position.tokenId)} ${text(position.token0Symbol)}/${text(position.token1Symbol)} fee=${text(
      position.fee,
    )} ticks=[${text(position.tickLower)},${text(position.tickUpper)}] owner=${text(position.owner)}`,
  );
  lines.push(
    `Liquidity: ${text(position.currentLiquidity)} -> remove ${text(liquidity.selected)} (${text(
      liquidity.mode,
    )}); remaining ${text(liquidity.remaining)} | collect=${text(data.collect)} burn=${text(data.burn)}`,
  );
  lines.push("Ordered steps:");
  for (const step of arr(data.orderedSteps).map(obj)) {
    const preview = obj(step.preview);
    lines.push(
      `  ${text(step.index)}. ${text(step.kind).toUpperCase()} — ${text(step.description)} -> ${text(obj(step.call).functionName)} ${text(
        obj(step.call).to,
      )}`,
    );
    if (step.error !== null) {
      lines.push(`     ERROR: ${text(obj(step.error).code)} ${text(obj(step.error).message)}`);
    } else {
      lines.push(
        `     requestId=${text(step.requestId)} requiresAppConfirmation=${text(
          preview.requireConfirmation,
        )} next=${text(step.nextCommand)}`,
      );
    }
  }
  const next = obj(data.next);
  lines.push("", `Next: ${text(next.note)}`);
  if (typeof next.recoveryAfterDecrease === "string" && next.recoveryAfterDecrease.length > 0) {
    lines.push(`Recovery after decrease confirms: ${next.recoveryAfterDecrease}`);
  }
  if (typeof next.recoveryCondition === "string" && next.recoveryCondition.length > 0) {
    lines.push(`Recovery condition: ${next.recoveryCondition}`);
  }
  if (typeof next.rePreviewCommand === "string" && next.rePreviewCommand.length > 0) {
    lines.push(`Re-preview: ${next.rePreviewCommand}`);
  }
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderQuote(data: Json): string {
  const quote = obj(data.quote);
  const lines = ["dex quote — read-only"];
  lines.push(...renderBaw(data.wallet));
  lines.push(`${text(quote.tokenInSymbol)} -> ${text(quote.tokenOutSymbol)} fee=${text(quote.fee)} pool=${text(quote.pool)}`);
  lines.push(`Amount in:  ${text(quote.amountInHuman)} (${text(quote.amountIn)} raw)`);
  lines.push(`Amount out: ${text(quote.amountOutHuman)} (${text(quote.amountOut)} raw)`);
  lines.push(`Caller: ${text(quote.caller)} | block ${text(data.blockNumber)}`);
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderSwap(data: Json): string {
  const swap = obj(data.swap);
  const lines = [`dex swap — PREVIEW ONLY (not sent) | status: ${text(data.status)}`];
  lines.push(...renderBaw(data.wallet));
  lines.push(
    `Pool: ${text(swap.pool)} ${text(swap.tokenInSymbol)} -> ${text(swap.tokenOutSymbol)} fee=${text(swap.fee)}${
      swap.nativeIn === true ? " (native BNB input)" : ""
    }${swap.nativeOut === true ? " (native BNB output via multicall)" : ""}`,
  );
  if (swap.nativeOut === true) {
    lines.push(`Resolved tokenOut: ${text(swap.tokenOutResolved)} (WBNB); unwrap recipient: ${text(swap.recipient)}`);
  }
  lines.push(`Amount in: ${text(swap.amountInHuman)} (${text(swap.amountIn)} raw) | value: ${text(swap.valueWei)} wei`);
  lines.push(`Min out: ${text(swap.amountOutMinimumHuman)} | quoted: ${text(swap.quotedAmountOutHuman)}`);
  lines.push(`Recipient: ${text(swap.recipient)}${swap.deadline === null ? "" : ` | deadline: ${text(swap.deadline)}`}`);
  for (const allowance of arr(data.allowances).map(obj)) {
    lines.push(
      `Allowance ${text(allowance.symbol)}: ${text(allowance.currentHuman)} / ${text(allowance.requiredHuman)} sufficient=${text(
        allowance.sufficient,
      )}`,
    );
  }
  lines.push(...renderNeedsApproval(data.needsApproval));
  if (data.preview !== undefined) lines.push(...renderCall(data.call), ...renderPreview(data.preview));
  if (data.status === "needsApproval") {
    const next = obj(data.next);
    lines.push("", `Next: ${text(next.note)}`);
  }
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderPositions(data: Json): string {
  const positions = arr(data.positions).map(obj);
  const lines = [`dex positions — owner ${text(data.owner)} | ${positions.length} position(s) | block ${text(data.blockNumber)}`];
  if (positions.length === 0) {
    lines.push("No positions.");
  } else {
    for (const position of positions) {
      lines.push(
        `#${text(position.tokenId)} ${text(position.token0Symbol)}/${text(position.token1Symbol)} fee=${text(position.fee)} ticks=[${text(
          position.tickLower,
        )},${text(position.tickUpper)}] liq=${text(position.liquidity)} owed=${text(position.tokensOwed0)}/${text(
          position.tokensOwed1,
        )} inRange=${text(position.inRange)} pool=${text(position.pool)}`,
      );
    }
  }
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderTxExecute(data: Json): string {
  const lines = ["tx execute — EXECUTED via Binance Agentic Wallet"];
  lines.push(`Request ID: ${text(data.requestId)}`);
  lines.push(`Status: ${text(data.status)} | orderId: ${text(data.orderId)} | txHash: ${text(data.txHash)}`);
  if (data.message !== null) lines.push(`Message: ${text(data.message)}`);
  const next = obj(data.next);
  lines.push(`Next: ${text(next.command)}`);
  lines.push(`Note: ${text(next.note)}`);
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

function renderTxStatus(data: Json): string {
  const lines = ["tx status"];
  lines.push(`Source: ${text(data.source)} | status: ${text(data.status)} | txHash: ${text(data.txHash)}`);
  if (data.orderId !== undefined) lines.push(`Order ID: ${text(data.orderId)} | requestId: ${text(data.requestId)}`);
  const tx = obj(data.tx);
  if (Object.keys(tx).length > 0) {
    lines.push(`BAW: chain=${text(tx.binanceChainId)} status=${text(tx.status)} time=${text(tx.txTime)}`);
  }
  if (data.note !== undefined) lines.push(`Note: ${text(data.note)}`);
  lines.push(...warningLines(data.warnings));
  return lines.join("\n");
}

/** Human-readable error text, including BAW risk details when present. */
export function renderErrorHuman(payload: ErrorPayload): string {
  const lines = [`error [${payload.error.code}]: ${payload.error.message}`];
  const details = obj(payload.error.details);
  const bawError = obj(details.bawError);
  const riskContainer = obj(obj(bawError.data).risks);
  if (Object.keys(riskContainer).length > 0) {
    lines.push("Risks:", ...renderRisks(riskContainer).map((line) => line.replace(/^  /, "")));
  }
  const call = obj(details.call);
  if (call.to !== undefined) {
    lines.push(`Call: ${text(call.functionName)} -> ${text(call.to)} (value=${text(call.valueWei)} wei)`);
  }
  return lines.join("\n");
}

/** Human-readable text for a successful command result; also used as MCP text content. */
export function renderHuman(result: Json): string {
  const data = toJsonSafe(result) as Json;
  switch (data.command) {
    case "doctor":
      return renderDoctor(data);
    case "status":
      return renderStatus(data);
    case "token create":
      return renderTokenCreate(data);
    case "token approve":
      return renderTokenApprove(data);
    case "dex pool create":
      return renderPoolCreate(data);
    case "dex lp add":
      return renderLpAdd(data);
    case "dex lp remove":
      return renderLpRemove(data);
    case "dex quote":
      return renderQuote(data);
    case "dex swap":
      return renderSwap(data);
    case "dex positions":
      return renderPositions(data);
    case "tx execute":
      return renderTxExecute(data);
    case "tx status":
      return renderTxStatus(data);
    default:
      return JSON.stringify(data, null, 2);
  }
}
