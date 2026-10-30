# Agentswap CLI — agent skill

Gated DEX for Agent ID assets, built on Agentic Protocol.

Use `agentswap` to create gated tokens and manage liquidity positions (LP) on **BSC mainnet (chain 56)** through **Binance Agentic Wallet (`baw`)**. Gated token transfers and gated LP/swap participation require an eligible Agent ID. Every write action is previewed first; execution is a separate confirmed step. The CLI never handles private keys.

New to these concepts? Read [Background and concepts](https://github.com/agentic-labs-hq/agentic-protocol/blob/main/docs/BACKGROUND.md). Agent ID is an identity record bound to the wallet, not the wallet address and not an AI model name. `agentswap doctor` is the source of truth for protocol eligibility.

## Preconditions

- Node.js 22.12+.
- `baw` 1.12.0+ on `PATH`: `npm install -g @binance/agentic-wallet@1.12.0`.
- Wallet connected: `baw auth signin --json`; complete `baw auth verify --qrCodeId <qrCodeId> --json`; then `baw wallet status --json` → `CONNECTED`.
- BSC address exists: `baw wallet address --json` (`binanceChainId: "56"`).
- Developer Mode enabled in the Binance App: Agentic Wallet → Settings → Developer Mode.
- Active Agent ID for receiving gated tokens, holding gated LP, and gated swaps. Check `baw wallet agent-id --json` for claim status and `agentswap doctor --json` for protocol eligibility.
- BNB in the Agentic Wallet for gas.

The official Binance Agentic Wallet command surface is the [Binance Agentic Wallet skill](https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/SKILL.md).

Check quickly:

```sh
baw --version
baw wallet status --json
baw wallet address --json
baw wallet settings --json
agentswap doctor --json
```

## Command surface

| Command | Purpose |
| --- | --- |
| `agentswap doctor [--json]` | Read-only BSC + BAW + Agent ID health check. |
| `agentswap status [--json]` | Chain, addresses, policy, and wallet snapshot. |
| `agentswap skill` | Print this guide. |
| `agentswap token create …` | Preview fixed-supply gated token creation. |
| `agentswap token approve …` | Preview ERC-20 approval/revoke. |
| `agentswap dex pool create …` | Preview gated pool creation. |
| `agentswap dex lp add …` | Preview LP mint, or output approval steps. |
| `agentswap dex lp remove …` | Preview decrease → collect → burn. |
| `agentswap dex quote …` | Read-only quote. |
| `agentswap dex swap …` | Preview exact-input swap; native input/output. |
| `agentswap dex positions [--owner]` | Read-only position-manager positions. |
| `agentswap tx execute --request-id <id> --confirm` | Execute one preview. |
| `agentswap tx status --tx-hash <hash>` | BAW transaction status. |
| `agentswap tx status --order-id <id>` | Local journal status after execute. |

All commands accept `--json` (one JSON object on stdout). Use `agentswap <command> --help` for flags.

## Standard flow

1. `agentswap doctor --json` — confirm chain 56, BAW connected, Developer Mode on, Agent ID eligibility, BNB.
2. Build a preview:

   ```sh
   agentswap token create --name "Example" --symbol EGT --supply 1000000 \
     --recipient 0x... --metadata-uri ipfs://... --json
   ```

3. Inspect the nested preview. Nothing has been sent.
   - Normal preview: `result.preview.requestId`, `result.preview.parsedTx`, `result.preview.simulationResult`, `result.preview.risks`, `result.preview.requireConfirmation`; next command is `result.preview.nextCommand` or `result.next.command`.
   - Approval branch: `result.needsApproval[i].preview.requestId` and `result.needsApproval[i].nextCommand`; execute approvals, then re-run the original command.
   - LP remove: `result.orderedSteps[i].requestId` (also `.preview.requestId`) and `result.orderedSteps[i].nextCommand`; `requiresSequentialExecution` means run in order. `result.next.recoveryAfterDecrease` is only for after the decrease confirms.
4. Execute only after the user explicitly approves that preview:

   ```sh
   agentswap tx execute --request-id <requestId> --confirm
   ```

5. If the result is `PENDING_CONFIRMATION`, the user confirms or rejects in the Binance App. After it broadcasts, obtain the txHash from the App/BAW and query it:

   ```sh
   agentswap tx status --tx-hash <hash>
   # --order-id is only the local last-known record; it is not a live query.
   ```

Never execute a preview the user has not reviewed. Never auto-execute. Facility creation and management are out of scope for this CLI; use the [protocol facility guide](https://github.com/agentic-labs-hq/agentic-protocol/blob/main/docs/FACILITY_GUIDE.md).

`tx execute` only accepts a requestId created by a local preview, for the current chain and wallet. It consumes that preview; unknown or reused IDs are rejected. The preview binding is stored in `AGENTSWAP_STATE_DIR` (default `~/.agentswap/tx-journal.json`); the execute process must be able to read the same state directory. Copying only the requestId to another machine, container, or user does not work.

`ok`, `executed`, and `preview.requireConfirmation` are not chain-confirmation signals. `executed:true` means BAW accepted the execute call; it can still return `PENDING_CONFIRMATION`. Use `tx status --tx-hash` for broadcast/chain status. ERC-20 `needsApproval` is a token allowance, not a transaction approval; the Binance App confirmation is a separate wallet-side step.

## LP mental model

- `decreaseLiquidity` removes liquidity and records principal/fees as
  `tokensOwed0/1`; it does not transfer them.
- `collect` transfers owed tokens.
- `burn` destroys the position NFT only when liquidity and both owed balances are
  zero. Collect first.
- `tickLower/tickUpper` are the price range, aligned to `tickSpacing`. Read
  `tickSpacing`, `currentTick`, and decimals from `dex positions` or token/pool
  metadata; the CLI does not calculate ticks from a price.
- New token/pool addresses are in `TokenCreated` / `GatedPoolCreated` events, not
  in the create preview. Use the explorer/BAW history or an indexer.
- `dex positions` gives token IDs for a later `lp remove`.

## Parameter conventions

- `--token`/`--quote` are logical names; `--amount0`/`--amount1` refer to the
  **sorted** token0/token1, not to the order you passed.
- `--amount*`, `--amount-in`, and `--min-out` are human units.
  `--min-amount0`/`--min-amount1` are raw base units.
- Fee tiers: `100` = 0.01%, `500` = 0.05%, `3000` = 0.30%, `10000` = 1.00%.
- `dex quote --exact-out` means `--amount-in` is the desired output amount.
- `dex lp remove --liquidity 50%` requires `--no-burn`; omit `--liquidity` to
  remove 100%. Use `--collect-only` after a confirmed decrease.

## Tokens and pools

```sh
agentswap token create --name <name> --symbol <symbol> --supply <18dp> \
  --recipient <addr> [--recipient <addr> ...] --metadata-uri <uri> [--policy <addr>]

agentswap token approve --token <addr> --spender <addr> --amount <human>
# amount 0 revokes. USDT-style tokens may need amount 0 before a new non-zero approval.

agentswap dex pool create --token <addr> --quote <addr> --fee <uint24> \
  (--price <quote-per-token> | --sqrt-price-x96 <uint160>)
```

- Token supply is fixed at 18 decimals and split evenly across recipients; remainder goes to the first.
- Initial recipients must be eligible agents or active CUSTODY/PURPOSE facilities.
- Pool creation requires at least one gated side; the wallet must be creator of every gated side; non-gated sides must be approved quote assets (WBNB/USDT).

## LP add

```sh
agentswap dex lp add --token <addr> --quote <addr> --fee <uint24> \
  --tick-lower <int24> --tick-upper <int24> --amount0 <human> --amount1 <human> \
  --min-amount0 <raw> --min-amount1 <raw> \
  [--recipient <addr>]
```

- Checks position-manager allowances first. Insufficient allowance → `status: "needsApproval"` with exact approval previews; the mint is not previewed yet.
- Execute approvals, then re-run the same add command.
- `--amount0`/`--amount1` are desired pool token0/token1 amounts.
- `--min-amount0`/`--min-amount1` are required raw base-unit lower bounds encoded into the mint. Use 0 only when you explicitly accept no protection on that side.

## LP remove

```sh
agentswap dex lp remove --token-id <id> [--liquidity <amount|percent>] \
  --min-amount0 <raw> --min-amount1 <raw> \
  [--collect-only] [--no-collect] [--no-burn]
```

- Default: full liquidity, collect max, burn.
- `--liquidity` accepts raw uint128 or a percentage such as `50%`; partial removal requires `--no-burn`.
- `--min-amount0`/`--min-amount1` are required whenever a decrease is present and are encoded into `decreaseLiquidity`.
- Preview returns `orderedSteps[]` with requestId/nextCommand and `requiresSequentialExecution`.
- Later steps may not preview before earlier steps are mined. Execute successful previews in order.
- If a decrease already executed and a later step failed, use `--collect-only`; do not re-run the original decrease command.
- No auto execution.

## Swap

```sh
agentswap dex swap --token-in <addr|BNB> --token-out <addr|BNB> --fee <uint24> \
  --amount-in <human> --min-out <human> [--recipient <addr>] [--deadline <seconds>] \
  [--native-out]
```

- ERC-20 input with insufficient allowance → `needsApproval` previews; execute them, then re-run.
- Native input (`BNB`/`native`/`ETH`/`0xEeee…`) sends `--value` in wei.
- `--native-out` requires a native `--token-out`; builds router `multicall(exactInputSingle → unwrapWETH9)` so BNB lands in the recipient. BNB → BNB is rejected. Verify BAW shows a native balance increase and no WBNB left.
- Without `--native-out`, WBNB output remains WBNB.
- `--min-out` is output units; for native output it is BNB units.

## Safety

- No private keys, key files, or key arguments.
- Binance Agentic Wallet is non-custodial and signs; the CLI only builds and previews calldata.
- Preview commands never broadcast.
- `tx execute` requires `--confirm` and a locally previewed, chain/wallet-bound requestId; it is consumed once.
- Binance App confirmation may also be required; whether it appears is controlled by BAW.
- LP/swap approvals are explicit previews, never silent.
- Mainnet is live. Use small amounts you can afford to lose.

## Addresses (BSC 56)

| Contract | Address |
| --- | --- |
| Agent ID registry | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |
| AgenticPolicy | `0xdb7FA5F2DDEaCF0Dbd7cd8ACa12A43A1050D4Ff7` |
| AgenticTokenFactory | `0x0c05551Ba2d262e99616634111ef693716A986ce` |
| AgenticAssetRegistry | `0xe2e2280B7662918564AC900801Ba80292602B1a1` |
| AgenticQuoteAssetRegistry | `0x5F3D85574A4eaee8438a24Df147a6878937784Ce` |
| AgentswapPoolFactory | `0xEc281F077C643CaDd4Ca90724C287552ca3e84e7` |
| AgentswapV3Factory | `0x83BC4672076BCb1167219fefC26089e45e75C813` |
| AgentswapPositionManager | `0x718204f0fb6A7ACD41D314abfD6331b43f502eC0` |
| AgentswapRouter | `0x460A4F74580369817c699A6F4fE3d2d2Ce1fef50` |
| AgentswapQuoter | `0xDB1874Adb5432ed3EC2153192c4243c64111AA5e` |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| USDT | `0x55d398326f99059fF775485246999027B3197955` |


## MCP

Server: `agentswap-mcp` (stdio). Config:

```json
{
  "mcpServers": {
    "agentswap": {
      "command": "npx",
      "args": ["-y", "-p", "@agentswap/cli@0.1.2", "agentswap-mcp"]
    }
  }
}
```

Read: `agentswap_doctor`, `agentswap_status`, `agentswap_dex_quote`, `agentswap_dex_positions`.
Preview: `agentswap_token_create`, `agentswap_token_approve`, `agentswap_dex_pool_create`, `agentswap_dex_lp_add`, `agentswap_dex_lp_remove`, `agentswap_dex_swap`.
Execute: `agentswap_tx_execute` (`requestId`, `confirmed: true`).
Status: `agentswap_tx_status` (`orderId` or `txHash`).

No key arguments. Preview tools never broadcast.

## Troubleshooting

| Code / symptom | Action |
| --- | --- |
| `BAW_NOT_INSTALLED` | Install `@binance/agentic-wallet@1.12.0`; ensure `baw` is on PATH. |
| `BAW_UNAVAILABLE` / TLS/network | Check network; re-run `baw wallet status --json`. |
| `BAW_NOT_CONNECTED` | `baw auth signin --json`; complete `baw auth verify --qrCodeId <qrCodeId> --json`; approve in Binance App. |
| `DEVMODE_REQUIRED` | Enable Developer Mode in the Binance App. |
| Agent ID ineligible | Check `baw wallet agent-id --json` for claim status; re-run `agentswap doctor` for protocol eligibility. |
| `CONFIRM_REQUIRED` | Review preview, then execute with `--confirm`. |
| `PENDING_CONFIRMATION` | Confirm/reject in Binance App; obtain txHash and query by hash. |
| `ORDER_NOT_FOUND` | Use `--tx-hash` after broadcast. |
| `MIN_OUT_TOO_HIGH` | Lower `--min-out` or refresh quote. |
| `BURN_REQUIRES_FULL_LIQUIDITY` | Remove 100% or pass `--no-burn`. |
| `NOT_POSITION_OWNER` | Position must belong to the Agentic Wallet BSC address. |

## Install

```sh
npx -y @agentswap/cli@0.1.2 doctor
# or explicit bin:
npx -y -p @agentswap/cli@0.1.2 agentswap doctor
```

Local tarball:

```sh
npm pack
npm install -g ./agentswap-cli-0.1.2.tgz
agentswap doctor
```

## Environment

- `AGENTSWAP_RPC_URL` — optional BSC RPC endpoint.
- `AGENTSWAP_STATE_DIR` — optional local order journal directory; no credentials.
