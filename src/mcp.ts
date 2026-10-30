#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { runDoctor } from "./core/doctor.js";
import { runLpAdd } from "./core/lp-add.js";
import { runLpRemove } from "./core/lp-remove.js";
import { runPoolCreate } from "./core/pool-create.js";
import { runPositions } from "./core/positions.js";
import { runQuote } from "./core/quote.js";
import { runStatus } from "./core/status.js";
import { runSwap } from "./core/swap.js";
import { runTokenApprove } from "./core/token-approve.js";
import { runTokenCreate } from "./core/token-create.js";
import { runTxExecute } from "./core/tx-execute.js";
import { runTxStatus } from "./core/tx-status.js";
import { errorPayload } from "./errors.js";
import { toJsonSafe } from "./json.js";
import { renderErrorHuman, renderHuman } from "./render.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { VERSION } from "./version.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

function success(result: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: renderHuman(result) }],
    structuredContent: toJsonSafe(result) as Record<string, unknown>,
  };
}

function failure(error: unknown, command: string): ToolResult {
  const payload = errorPayload(error, command);
  return {
    isError: true,
    content: [{ type: "text", text: renderErrorHuman(payload) }],
    structuredContent: toJsonSafe(payload) as Record<string, unknown>,
  };
}

async function execute(
  command: string,
  action: (runtime: Runtime) => Promise<Record<string, unknown>>,
): Promise<ToolResult> {
  try {
    return success(await action(createRuntime()));
  } catch (error) {
    return failure(error, command);
  }
}

const READ_ANNOTATIONS = { readOnlyHint: true, openWorldHint: true } as const;
const PREVIEW_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;
const EXECUTE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const WALLET_NOTE =
  "Non-custodial Binance Agentic Wallet: no private key is accepted or handled by this tool. Preview only; execution requires a separate confirmed tx tool. Any additional Binance App approval is controlled by BAW.";

const server = new McpServer({ name: "agentswap", version: VERSION });

server.registerTool(
  "agentswap_doctor",
  {
    title: "Agentswap doctor",
    description:
      "Read-only health check: BSC chain 56, core contract code, factory wiring, quote assets, current policy, canonical pool factory owner, plus Binance Agentic Wallet CLI version/status/BSC address/Developer Mode/Agent ID/BNB balance/tx-lock. No signing, no transaction.",
    inputSchema: {},
    annotations: READ_ANNOTATIONS,
  },
  async () => execute("doctor", (runtime) => runDoctor(runtime)),
);

server.registerTool(
  "agentswap_status",
  {
    title: "Agentswap status",
    description:
      "Read-only status: chain head, gas price, token factory, quote assets, policy, canonical factory ownership, and Binance Agentic Wallet state. BAW unavailability is reported with healthy=false.",
    inputSchema: {},
    annotations: READ_ANNOTATIONS,
  },
  async () => execute("status", (runtime) => runStatus(runtime)),
);

server.registerTool(
  "agentswap_token_create",
  {
    title: "Preview gated token creation",
    description: `Build AgenticTokenFactory.createToken calldata and preview it via baw contract-call preview. The caller becomes the creator; every recipient must be an eligible Agent ID wallet or an active CUSTODY/PURPOSE facility. Supply is split evenly and fixed at creation. ${WALLET_NOTE} Read the requestId from preview.requestId and the execute command from preview.nextCommand; top-level next.command is equivalent. Sends nothing.`,
    inputSchema: {
      name: z.string().min(1).max(64).describe("Token name (1-64 characters)."),
      symbol: z.string().min(1).max(16).describe("Token symbol (1-16 characters)."),
      supply: z.string().describe("Human 18-decimal total supply, e.g. \"1000000\"."),
      recipients: z.array(z.string()).min(1).describe("Eligible Agent ID wallets or active CUSTODY/PURPOSE facilities; supply is split evenly."),
      metadataUri: z.string().describe("Opaque off-chain URI stored by the token; the CLI does not upload, fetch, or validate its JSON schema. No whitespace."),
      policy: z.string().optional().describe("Optional transfer policy; defaults to the current policy."),
    },
    annotations: PREVIEW_ANNOTATIONS,
  },
  async (args) =>
    execute("token create", (runtime) =>
      runTokenCreate(runtime, {
        name: args.name,
        symbol: args.symbol,
        supply: args.supply,
        recipients: args.recipients,
        metadataUri: args.metadataUri,
        ...(args.policy === undefined ? {} : { policy: args.policy }),
      }),
    ),
);

server.registerTool(
  "agentswap_token_approve",
  {
    title: "Preview ERC-20 approval",
    description: `Build ERC-20 approve(spender, amount) calldata and preview it. Use amount 0 to revoke. ${WALLET_NOTE} Read preview.requestId and preview.nextCommand.`,
    inputSchema: {
      token: z.string().describe("ERC-20 token address."),
      spender: z.string().describe("Spender address (e.g. the position manager or router)."),
      amount: z.string().describe("Human token amount; 0 revokes."),
    },
    annotations: PREVIEW_ANNOTATIONS,
  },
  async (args) =>
    execute("token approve", (runtime) =>
      runTokenApprove(runtime, {
        token: args.token,
        spender: args.spender,
        amount: args.amount,
      }),
    ),
);

server.registerTool(
  "agentswap_dex_pool_create",
  {
    title: "Preview gated pool creation",
    description: `Build AgentswapPoolFactory.createPool calldata and preview it. At least one side must be a gated asset; the caller must be the creator of every gated side; every non-gated side must be an approved quote asset. Provide exactly one of price/sqrtPriceX96. ${WALLET_NOTE} Read the requestId from preview.requestId and the next command from preview.nextCommand.`,
    inputSchema: {
      token: z.string().describe("Token address."),
      quote: z.string().describe("Quote/token address (must differ). The on-chain token0/token1 order may differ."),
      fee: z.number().int().positive().describe("Uniswap V3 fee tier (100, 500, 3000, or 10000)."),
      price: z.string().optional().describe("Human quote-token units per one token unit."),
      sqrtPriceX96: z.string().optional().describe("Raw Q64.96 sqrt price (decimal integer)."),
    },
    annotations: PREVIEW_ANNOTATIONS,
  },
  async (args) =>
    execute("dex pool create", (runtime) =>
      runPoolCreate(runtime, {
        token: args.token,
        quote: args.quote,
        fee: String(args.fee),
        ...(args.price === undefined ? {} : { price: args.price }),
        ...(args.sqrtPriceX96 === undefined ? {} : { sqrtPriceX96: args.sqrtPriceX96 }),
      }),
    ),
);

server.registerTool(
  "agentswap_dex_lp_add",
  {
    title: "Preview gated LP mint or approvals",
    description: `Check position-manager allowances; if insufficient, return status=needsApproval with exact approval previews (including USDT-style resets) and do not preview the mint. If sufficient, build position-manager mint calldata and preview it. token/quote are logical sides; amount0/amount1 refer to the sorted token0/token1. amount0/amount1 are human units; minAmount0/minAmount1 are required raw base units. ${WALLET_NOTE} For approvals read needsApproval[i].preview.requestId and needsApproval[i].nextCommand, then re-run this tool after they confirm. For a mint read preview.requestId.`,
    inputSchema: {
      token: z.string().describe("One logical side of the pool."),
      quote: z.string().describe("Other logical side (must differ). On-chain token0/token1 may be sorted differently."),
      fee: z.number().int().positive().describe("Pool fee tier."),
      tickLower: z.number().int().describe("Lower tick, aligned to the pool tick spacing."),
      tickUpper: z.number().int().describe("Upper tick, aligned to the pool tick spacing."),
      amount0: z.string().describe("Desired sorted token0 amount, human units."),
      amount1: z.string().describe("Desired sorted token1 amount, human units."),
      minAmount0: z.string().describe("Required raw base-unit sorted token0 minimum."),
      minAmount1: z.string().describe("Required raw base-unit sorted token1 minimum."),
      recipient: z.string().optional().describe("Position recipient; must be an eligible agent; defaults to the Agentic Wallet."),
    },
    annotations: PREVIEW_ANNOTATIONS,
  },
  async (args) =>
    execute("dex lp add", (runtime) =>
      runLpAdd(runtime, {
        token: args.token,
        quote: args.quote,
        fee: String(args.fee),
        tickLower: String(args.tickLower),
        tickUpper: String(args.tickUpper),
        amount0: args.amount0,
        amount1: args.amount1,
        minAmount0: args.minAmount0,
        minAmount1: args.minAmount1,
        ...(args.recipient === undefined ? {} : { recipient: args.recipient }),
      }),
    ),
);

server.registerTool(
  "agentswap_dex_lp_remove",
  {
    title: "Preview LP decrease/collect/burn",
    description: `Read a position-manager position owned by the Binance Agentic Wallet, then build and preview decreaseLiquidity -> collect(max) -> burn in order. liquidity omitted means full; accepts a raw uint128 amount or a percentage like "50%". Partial removal requires noBurn=true. When decreasing, minAmount0/minAmount1 are required raw base units. Returns orderedSteps[i].requestId (also orderedSteps[i].preview.requestId) and orderedSteps[i].nextCommand; top-level next.commands lists successful steps and next.recoveryAfterDecrease is the collect-only recovery after the decrease confirms. requiresSequentialExecution=true means execute in order, do not re-run the decrease. Never executes. ${WALLET_NOTE}`,
    inputSchema: {
      tokenId: z.string().describe("position-manager tokenId (decimal string)."),
      liquidity: z.string().optional().describe("Raw liquidity amount or percentage such as \"50%\"; omitted = full."),
      minAmount0: z.string().optional().describe("Raw base-unit token0 minimum for decreaseLiquidity; required with minAmount1 when decreasing."),
      minAmount1: z.string().optional().describe("Raw base-unit token1 minimum for decreaseLiquidity; required with minAmount0 when decreasing."),
      noCollect: z.boolean().default(false).describe("Skip the collect step."),
      noBurn: z.boolean().default(false).describe("Skip the burn step; required for partial removal."),
      collectOnly: z.boolean().default(false).describe("Skip decrease; only collect/burn after a decrease has already executed."),
    },
    annotations: PREVIEW_ANNOTATIONS,
  },
  async (args) =>
    execute("dex lp remove", (runtime) =>
      runLpRemove(runtime, {
        tokenId: args.tokenId,
        ...(args.liquidity === undefined ? {} : { liquidity: args.liquidity }),
        minAmount0: args.minAmount0,
        minAmount1: args.minAmount1,
        noCollect: args.noCollect,
        noBurn: args.noBurn,
        collectOnly: args.collectOnly,
      }),
    ),
);

server.registerTool(
  "agentswap_dex_quote",
  {
    title: "Quote swap",
    description:
      "Read-only quote via the gated-aware AgentswapQuoter. The Binance Agentic Wallet BSC address is the simulated caller, so gated output uses its Agent ID policy. exactOut=true treats amountIn as the desired output.",
    inputSchema: {
      tokenIn: z.string().describe("Input token address."),
      tokenOut: z.string().describe("Output token address."),
      fee: z.number().int().positive().describe("Pool fee tier."),
      amountIn: z.string().describe("Human amount: exact input, or exact output when exactOut=true."),
      exactOut: z.boolean().default(false).describe("Quote exact output instead of exact input."),
    },
    annotations: READ_ANNOTATIONS,
  },
  async (args) =>
    execute("dex quote", (runtime) =>
      runQuote(runtime, {
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        fee: String(args.fee),
        amountIn: args.amountIn,
        exactOut: args.exactOut,
      }),
    ),
);

server.registerTool(
  "agentswap_dex_swap",
  {
    title: "Preview exact-input swap or approval",
    description: `Check the ERC-20 input allowance; if insufficient, return needsApproval previews and do not preview the swap. If sufficient (or native BNB input), build and preview the swap. Native input accepts BNB/native/eth/0xEeee... and sets the preview value in wei. With nativeOut=true, tokenOut must be a native alias; the router multicall swaps to WBNB with recipient=router then unwrapWETH9 sends BNB to the recipient. ${WALLET_NOTE} Read needsApproval[i].preview.requestId or preview.requestId, and the matching nextCommand/next.commands.`,
    inputSchema: {
      tokenIn: z.string().describe("Input token address or BNB/native for native BNB."),
      tokenOut: z.string().describe("Output token address, or native alias when nativeOut=true."),
      fee: z.number().int().positive().describe("Pool fee tier."),
      amountIn: z.string().describe("Exact human input amount."),
      minOut: z.string().describe("Minimum human output amount (BNB units when nativeOut)."),
      recipient: z.string().optional().describe("Output recipient; defaults to the Agentic Wallet."),
      deadline: z.number().int().min(30).max(86400).optional().describe("Seconds from now (default 600)."),
      nativeOut: z.boolean().default(false).describe("Unwrap WBNB output to native BNB via router multicall."),
    },
    annotations: PREVIEW_ANNOTATIONS,
  },
  async (args) =>
    execute("dex swap", (runtime) =>
      runSwap(runtime, {
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        fee: String(args.fee),
        amountIn: args.amountIn,
        minOut: args.minOut,
        ...(args.recipient === undefined ? {} : { recipient: args.recipient }),
        ...(args.deadline === undefined ? {} : { deadline: String(args.deadline) }),
        nativeOut: args.nativeOut,
      }),
    ),
);

server.registerTool(
  "agentswap_dex_positions",
  {
    title: "List LP positions",
    description:
      "Read-only position-manager list. owner defaults to the Binance Agentic Wallet BSC address; owner can be supplied without BAW. Includes pair, fee, ticks, liquidity, owed tokens, pool, current tick, and in-range status.",
    inputSchema: {
      owner: z.string().optional().describe("Owner address; defaults to the Agentic Wallet."),
    },
    annotations: READ_ANNOTATIONS,
  },
  async (args) =>
    execute("dex positions", (runtime) =>
      runPositions(runtime, {
        ...(args.owner === undefined ? {} : { owner: args.owner }),
      }),
    ),
);

server.registerTool(
  "agentswap_tx_execute",
  {
    title: "Execute previewed request",
    description:
      "EXECUTES exactly one requestId returned by a previous preview via baw contract-call execute. Requires confirmed:true; no key argument is accepted. Signing and any Binance App confirmation happen in Binance Agentic Wallet. Refuses without confirmed:true. requestId comes from preview.requestId, needsApproval[i].preview.requestId, or orderedSteps[i].requestId. The preview binding is local, single-use, and must be readable from AGENTSWAP_STATE_DIR by the execute process; copying only the requestId to another machine, container, or user will fail.",
    inputSchema: {
      requestId: z.string().min(1).describe("preview.requestId, needsApproval[i].preview.requestId, or orderedSteps[i].requestId."),
      confirmed: z.boolean().optional().describe("Must be true; explicit confirmation to execute."),
    },
    annotations: EXECUTE_ANNOTATIONS,
  },
  async (args) =>
    execute("tx execute", (runtime) =>
      runTxExecute(runtime, {
        requestId: args.requestId,
        confirm: args.confirmed === true,
      }),
    ),
);

server.registerTool(
  "agentswap_tx_status",
  {
    title: "Transaction status",
    description:
      "Query status by txHash through BAW, or by orderId from the local journal written by tx execute. The BAW contract-call flow has no orderId lookup. Read-only.",
    inputSchema: {
      orderId: z.string().optional().describe("orderId from tx execute (local journal)."),
      txHash: z.string().optional().describe("0x transaction hash (BAW tx-history lookup)."),
    },
    annotations: READ_ANNOTATIONS,
  },
  async (args) =>
    execute("tx status", (runtime) =>
      runTxStatus(runtime, {
        ...(args.orderId === undefined ? {} : { orderId: args.orderId }),
        ...(args.txHash === undefined ? {} : { txHash: args.txHash }),
      }),
    ),
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agentswap-mcp failed to start: ${message}\n`);
  process.exitCode = 1;
});
