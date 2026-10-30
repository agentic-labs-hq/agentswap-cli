import { COMMANDS } from "./args.js";
import { PROGRAM } from "./version.js";

const GLOBAL_OPTIONS = `Global options:
  --json                 Print exactly one JSON object to stdout.
  -h, --help             Show help.
  --version              Show the package version.`;

const ENVIRONMENT = `Environment:
  AGENTSWAP_RPC_URL        BSC RPC endpoint. Defaults to the address book's rpcUrl (public BSC).
  AGENTSWAP_STATE_DIR      State directory (default ~/.agentswap): tx-journal.json stores preview bindings and execution records. Preview and execute must share it.`;

const WALLET = `Binance Agentic Wallet (non-custodial):
  - Requires the official \`baw\` CLI 1.12.0+ and a connected Agentic Wallet.
  - BSC address comes from \`baw wallet address --json\` (binanceChainId 56).
  - Developer Mode must be enabled in the Binance App for contract-call preview.
  - This CLI builds calldata and previews through \`baw contract-call preview\`.
    It never signs, never handles key material, and never executes automatically.
  - Execute separately with "agentswap tx execute --request-id <id> --confirm".
    Binance may require confirmation in the Binance App.`;

const SAFETY = `Safety:
  - Every token/pool/LP/swap/approve command is PREVIEW ONLY and sends nothing.
  - LP/swap with insufficient allowance returns structured needsApproval previews.
  - tx execute refuses without --confirm and only uses a preview requestId.
  - tx status --order-id reads a local journal (the BAW contract-call flow has no
    order status); tx status --tx-hash queries BAW directly.`;

export const MAIN_HELP = `Agentswap CLI — gated DEX for Agent ID assets, built on Agentic Protocol

Usage:
  ${PROGRAM} <command> [options]

Read-only:
  doctor [--json]                                      RPC + BAW + Agent ID health.
  status [--json]                                      Chain/address-book/wallet snapshot.
  skill [--json]                                       Print the packaged SKILL.md guide.
  dex quote --token-in --token-out --fee --amount-in    Quote via the gated Quoter.
             [--exact-out] [--json]
  dex positions [--owner] [--json]                     List liquidity positions.

Preview only (returns requestId; sends nothing):
  token create --name --symbol --supply --recipient     Preview gated token creation.
               [--recipient ...] --metadata-uri [--policy] [--json]
  token approve --token --spender --amount [--json]     Preview exact ERC-20 approval/revoke.
  dex pool create --token --quote --fee                 Preview gated pool creation.
                  (--price|--sqrt-price-x96) [--json]
  dex lp add --token --quote --fee --tick-lower         Preview gated LP mint, or return
             --tick-upper --amount0 --amount1           needsApproval previews.
             --min-amount0 --min-amount1                 Minima are required raw base units.
             [--recipient] [--json]
  dex lp remove --token-id <id> [--liquidity <amount|%>] Preview decrease/collect/burn
                --min-amount0 --min-amount1             steps; minima are required for
                [--collect-only] [--no-collect]          decrease. --collect-only finishes a
                [--no-burn] [--json]                     decrease that already executed.
  dex swap --token-in --token-out --fee --amount-in     Preview exact-input swap, or return
           --min-out [--recipient] [--deadline]         needsApproval previews. --token-in
           [--native-out] [--json]                      accepts BNB/native input; --native-out
                                                       unwraps WBNB output to BNB.

Execution (separate and explicit):
  tx execute --request-id <id> --confirm [--json]      Execute one previewed request.
  tx status (--order-id <id> | --tx-hash <hash>)        Query status. --order-id uses the
           [--json]                                     local journal; --tx-hash uses BAW.

${GLOBAL_OPTIONS}

${ENVIRONMENT}

${WALLET}

${SAFETY}

Run "${PROGRAM} <command> --help" for command-specific help.`;

const doctorHelp = `Usage: ${PROGRAM} doctor [--json]

Read-only checks: chain 56, core contract code, factory wiring, quote assets,
current policy, canonical factory owner, plus the Binance Agentic Wallet:
CLI version, CONNECTED status, BSC address, Developer Mode, Agent ID
eligibility, BNB balance, and tx-lock.

No signing, no preview. Returns BAW_UNAVAILABLE if the local \`baw\` cannot
reach Binance (for example a TLS/network sandbox).`;

const skillHelp = `Usage: ${PROGRAM} skill [--json]

Prints the packaged SKILL.md operational guide for agents. With --json, returns
one object containing the guide text.`;

const statusHelp = `Usage: ${PROGRAM} status [--json]

Read-only snapshot: chain head, gas price, address-book factories, policy,
canonical factory owner, and Binance Agentic Wallet state. If BAW is
unavailable, the result reports it with healthy=false instead of aborting the
RPC snapshot.`;

const tokenCreateHelp = `Usage: ${PROGRAM} token create --name <name> --symbol <symbol> --supply <amount>
                           --recipient <address> [--recipient <address> ...]
                           --metadata-uri <uri> [--policy <address>] [--json]

Builds AgenticTokenFactory.createToken calldata and previews it through BAW.
Supply is fixed at 18 decimals and split evenly across recipients (remainder to
the first). Recipients must be agents or active CUSTODY/PURPOSE facilities
(project token custody or game/escrow utility).

Read preview.requestId, preview.parsedTx, preview.simulationResult,
preview.risks, and preview.requireConfirmation; preview.nextCommand is the next
execute command. The metadata URI is stored as-is and is not uploaded, fetched,
or validated. Nothing is sent.`;

const tokenApproveHelp = `Usage: ${PROGRAM} token approve --token <address> --spender <address> --amount <human>
                            [--json]

Builds ERC-20 approve(spender, amount) calldata and previews it. Use amount 0
to revoke. USDT-style tokens may require a reset to 0 before a new non-zero
allowance; LP/swap previews plan that reset automatically.

Preview only; execute with "agentswap tx execute --request-id <id> --confirm".`;

const poolCreateHelp = `Usage: ${PROGRAM} dex pool create --token <address> --quote <address> --fee <uint24>
                               (--price <quote-per-token> | --sqrt-price-x96 <uint160>)
                               [--json]

Builds AgentswapPoolFactory.createPool calldata and previews it. Rules checked
before preview: at least one side is a registered gated asset; the Agentic
Wallet is the creator of every gated side; non-gated sides are approved quote
assets; fee tier enabled; no existing pool.

--price is quote-token units per one token unit; token ordering and decimals are
handled automatically. Preview only.`;

const lpAddHelp = `Usage: ${PROGRAM} dex lp add --token <address> --quote <address> --fee <uint24>
                          --tick-lower <int24> --tick-upper <int24>
                          --amount0 <human> --amount1 <human>
                          --min-amount0 <raw> --min-amount1 <raw>
                          [--recipient <address>] [--json]

Checks position-manager allowances first. If an allowance is insufficient, returns
needsApproval entries containing exact approve previews (including USDT-style
resets) and does NOT preview the mint. Execute those approvals, then re-run this
command to preview the mint.

When allowances are sufficient, builds position-manager mint calldata (deadline 20 minutes
from the latest block) and previews it. --amount0/--amount1 are pool token0 and
token1 desired amounts. --min-amount0/--min-amount1 are required raw base-unit
lower bounds encoded into the mint; use 0 only when you explicitly accept no
protection on that side. Both recipient and payer must be eligible agents for
gated tokens. Preview only; execute separately.`;

const lpRemoveHelp = `Usage: ${PROGRAM} dex lp remove --token-id <id> [--liquidity <amount|percent>]
                          --min-amount0 <raw> --min-amount1 <raw>
                          [--collect-only] [--no-collect] [--no-burn] [--json]

Reads the position-manager position and requires the Binance Agentic Wallet to own it.
Defaults: full current liquidity, collect max token0/token1, then burn the NFT.
--liquidity accepts a raw uint128 amount or a percentage such as "50%".
--min-amount0/--min-amount1 are raw base-unit lower bounds and are required
whenever a decrease step is present; they are encoded into decreaseLiquidity.
Partial removal requires --no-burn (burn reverts unless liquidity is zero).
--collect-only skips decrease and only previews collect (plus burn if liquidity
is already zero); use it after a decrease has confirmed. --no-collect cannot be
combined with burn when liquidity or tokensOwed remain, because burn requires
both to be zero.

Builds and previews decreaseLiquidity -> collect -> burn in order, returning
orderedSteps with requestId/nextCommand for each successful preview. Later
steps may not preview before earlier steps are mined; requiresSequentialExecution
is set and the result tells you to execute in order. No auto execute.`;

const quoteHelp = `Usage: ${PROGRAM} dex quote --token-in <address> --token-out <address> --fee <uint24>
                        --amount-in <human> [--exact-out] [--json]

Read-only quote through AgentswapQuoter with the Binance Agentic Wallet BSC
address as the simulated caller. Gated output requires that wallet to be an
eligible agent. With --exact-out, --amount-in is the desired output amount and
the result is the required input.

Examples:
  ${PROGRAM} dex quote --token-in <in> --token-out <out> --fee 3000 --amount-in 1
  ${PROGRAM} dex quote --token-in <in> --token-out <out> --fee 3000 --amount-in 1 --exact-out
  # second command asks for 1 unit of output; it is not 1 unit of input.`;

const swapHelp = `Usage: ${PROGRAM} dex swap --token-in <address|BNB> --token-out <address> --fee <uint24>
                       --amount-in <human> --min-out <human>
                       [--recipient <address>] [--deadline <seconds>] [--json]

Builds and previews an exact-input swap. ERC-20 input with insufficient
allowance returns needsApproval previews instead of a swap preview. Native BNB
input accepts "BNB", "native", "eth", or the 0xEeee... sentinel and sets the BAW
preview --value to the input amount in wei (calldata uses WBNB).

With --native-out, --token-out must be a native alias. The router multicall
swaps to WBNB with recipient=router, then unwrapWETH9(min-out, recipient) sends
BNB to the recipient. BNB -> BNB is rejected; normal WBNB output is used when
--native-out is absent. BAW must show a native balance increase and no WBNB left.

Preview only. Execute with "agentswap tx execute --request-id <id> --confirm".`;

const positionsHelp = `Usage: ${PROGRAM} dex positions [--owner <address>] [--json]

Lists NonfungiblePositionManager positions using ERC721Enumerable. Owner
defaults to the Binance Agentic Wallet BSC address; --owner works without BAW.
Includes pair, fee, ticks, liquidity, owed tokens, pool, current tick, and
in-range status. Read-only.`;

const txExecuteHelp = `Usage: ${PROGRAM} tx execute --request-id <id> --confirm [--json]

Executes exactly one requestId returned by a previous preview via
\`baw contract-call execute --requestId <id> --json\`. Requires --confirm;
refuses without it. No key material is handled here — signing and any Binance
App confirmation happen in the Binance Agentic Wallet.

If BAW returns PENDING_CONFIRMATION, confirm in the Binance App, then check
last-known local status by orderId, or live status by txHash.`;

const txStatusHelp = `Usage: ${PROGRAM} tx status --tx-hash <hash> [--json]
       ${PROGRAM} tx status --order-id <id> [--json]

--tx-hash queries BAW's transaction status by hash.
--order-id reads the local journal written by tx execute. The BAW contract-call flow has no
orderId status endpoint; if a txHash was recorded, it is refreshed
through BAW, otherwise the last known local status is shown with an explicit
freshness marker. It is not a live chain query.`;

const COMMAND_HELP: Record<string, string> = {
  doctor: doctorHelp,
  status: statusHelp,
  skill: skillHelp,
  "token create": tokenCreateHelp,
  "token approve": tokenApproveHelp,
  "dex pool create": poolCreateHelp,
  "dex lp add": lpAddHelp,
  "dex lp remove": lpRemoveHelp,
  "dex quote": quoteHelp,
  "dex swap": swapHelp,
  "dex positions": positionsHelp,
  "tx execute": txExecuteHelp,
  "tx status": txStatusHelp,
};

export function helpFor(command: string): string {
  return COMMAND_HELP[command] ?? MAIN_HELP;
}

export function commandList(): string[] {
  return Object.keys(COMMANDS);
}
