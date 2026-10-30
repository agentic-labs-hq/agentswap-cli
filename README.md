# Agentswap CLI

Gated DEX for Agent ID assets, built on Agentic Protocol.

Create gated tokens and manage liquidity positions (LP) on **BNB Smart Chain (BSC)** through **Binance Agentic Wallet (`baw`)**, from the terminal or an MCP client. Gated token transfers and gated LP/swap participation require an eligible Agent ID.

Every write operation is built and simulated first. Nothing is sent until you review the result and run a separate execute command with `--confirm`. Signing and any final approval happen in Binance Agentic Wallet / the Binance App. This CLI does not handle private keys.

This package covers token, pool, LP, quote, and swap operations for end users. Facility creation/management is a protocol builder integration and is not part of this CLI; see the [Agentic Protocol facility guide](https://github.com/agentic-labs-hq/agentic-protocol/blob/main/docs/FACILITY_GUIDE.md).

New to Agent ID or Binance Agentic Wallet? Read [Background and concepts](https://github.com/agentic-labs-hq/agentic-protocol/blob/main/docs/BACKGROUND.md) first. In short:

- **Agent ID** is an identity record bound to a BSC wallet. It is not the wallet address, and it is not an AI model identifier.
- **Binance Agentic Wallet** is the non-custodial wallet and App confirmation flow. The CLI talks to it through the `baw` command.
- **Eligible / active** means the protocol's live Agent ID check passes for the connected wallet. `agentswap doctor` reports the actual result.

A few protocol terms used below:

- **Gated token**: a fixed-supply ERC-20 whose transfer policy checks the sender and recipient. The policy is fixed when the token is created.
- **Gated pool**: a stable, gated Uniswap V3 pool. Swaps and LP are agent-only.
- **Facility**: a standard on-chain contract for a project's own token custody/roles. The CLI does not create facilities; if you only create tokens, pools, LP, or swaps, you do not need one. Initial token recipients may be active CUSTODY/PURPOSE facilities.

## Before you start

- **Node.js 22.12+**.
- **Binance Agentic Wallet** with a BSC address.
- **`baw` 1.12.0+** on `PATH`:

  ```sh
  npm install -g @binance/agentic-wallet@1.12.0
  ```

  `baw` is the official Binance Agentic Wallet CLI. See the
  [Binance Agentic Wallet skill](https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/SKILL.md)
  for its full command surface.
- Wallet signed in: `baw auth signin --json`, complete
  `baw auth verify --qrCodeId <qrCodeId> --json`, then
  `baw wallet status --json` must be `CONNECTED`.
- **Developer Mode enabled** in the Binance App: Agentic Wallet → Settings →
  Developer Mode. Contract-call preview/execute requires it.
- **Agent ID**: an eligible Agent ID is required to receive gated tokens, hold
  gated LP, and swap gated assets. Check claim status with
  `baw wallet agent-id --json`; check the protocol's actual eligibility with
  `agentswap doctor --json`.
- **BNB for gas** in the Agentic Wallet.

Confirm the prerequisites:

```sh
baw --version
baw wallet status --json
baw wallet address --json      # use binanceChainId 56
baw wallet settings --json     # devMode.enabled must be true
baw wallet agent-id --json     # claim status; doctor checks protocol eligibility
```

## Install and run

The main path is a global install, which puts `agentswap` and `agentswap-mcp`
on `PATH`:

```sh
npm install -g @agentswap/cli@0.1.2
agentswap doctor
```

If you do not want a global install, use `npx` consistently for every command:

```sh
npx -y @agentswap/cli@0.1.2 doctor
# explicit bin form, useful when npx does not pick a bin automatically:
npx -y -p @agentswap/cli@0.1.2 agentswap doctor
```

Do not mix the two styles in one session: a bare `agentswap` assumes the global
install, while `npx …` runs the package for that command.

From a local tarball:

```sh
npm install -g ./agentswap-cli-0.1.2.tgz
agentswap doctor
agentswap skill
```

## First run: doctor → preview → confirm → execute

```sh
# 1. Check BSC wiring, BAW status, Developer Mode, Agent ID, and BNB.
agentswap doctor --json

# 2. Preview an operation. This sends nothing.
agentswap token create \
  --name "Example Agent Token" --symbol EGT --supply 1000000 \
  --recipient 0x1111111111111111111111111111111111111111 \
  --metadata-uri ipfs://example/token.json --json
# Replace the recipient with an eligible Agent ID wallet.

# 3. Review the response. For a normal preview the requestId is nested:
#    {
#      "ok": true,
#      "command": "token create",
#      "previewOnly": true,
#      "executed": false,
#      "preview": {
#        "requestId": "0x…",
#        "parsedTx": { … },
#        "simulationResult": { … },
#        "risks": { … },
#        "requireConfirmation": true,
#        "nextCommand": "agentswap tx execute --request-id 0x… --confirm"
#      },
#      "next": { "command": "agentswap tx execute --request-id 0x… --confirm", … },
#      "warnings": [ … ]
#    }
#    Read result.preview.requestId. If allowances are missing, the result has
#    status="needsApproval" and the requestId is under
#    result.needsApproval[i].preview.requestId.

# 4. Execute exactly that preview after explicit confirmation.
agentswap tx execute --request-id <requestId> --confirm

# 5. If the response is PENDING_CONFIRMATION, approve/reject in the Binance App.
#    After it broadcasts, obtain the txHash from the App/BAW and query it:
agentswap tx status --tx-hash <txHash>
# --order-id is only the local last-known record; it is not a live chain query.
```

Preview commands never call `execute`. `agentswap tx execute` refuses without `--confirm`, and it only accepts a `requestId` created by a local preview bound to the current chain and wallet. A requestId from elsewhere is rejected.

### The three identifiers

| Identifier | Scope | What to do with it |
| --- | --- | --- |
| `requestId` | One local preview, bound to chain and wallet | Pass to `tx execute --request-id`. Consumed once. |
| `orderId` | Local journal entry created after execute | Last-known local record; not a live chain query. |
| `txHash` | Broadcast transaction | Use `tx status --tx-hash` for live BAW/chain status. |

### Where to read the next step

| Response shape | `requestId` path | command path |
| --- | --- | --- |
| Normal preview (`token create`, `pool create`, normal `lp add`, `swap`) | `result.preview.requestId` | `result.preview.nextCommand` or `result.next.command` |
| Approval preview (`status: "needsApproval"`) | `result.needsApproval[i].preview.requestId` | `result.needsApproval[i].nextCommand` or `result.next.commands[i]` |
| Multi-step LP remove (`orderedSteps`) | `result.orderedSteps[i].requestId` (also `.preview.requestId`) | `result.orderedSteps[i].nextCommand` or `result.next.commands[i]` |
| Error | none | `result.error.code` / `result.error.message` |

Approval branch shape:

```json
{
  "status": "needsApproval",
  "needsApproval": [
    {
      "kind": "approve",
      "preview": { "requestId": "0x…", "nextCommand": "agentswap tx execute --request-id 0x… --confirm" },
      "nextCommand": "agentswap tx execute --request-id 0x… --confirm"
    }
  ],
  "next": { "commands": ["agentswap tx execute --request-id 0x… --confirm"] }
}
```

LP remove branch shape:

```json
{
  "requiresSequentialExecution": true,
  "orderedSteps": [
    {
      "index": 1,
      "kind": "decrease",
      "requestId": "0x…",
      "nextCommand": "agentswap tx execute --request-id 0x… --confirm",
      "preview": { "requestId": "0x…" }
    }
  ],
  "next": {
    "commands": ["agentswap tx execute --request-id 0x… --confirm"],
    "recoveryAfterDecrease": "agentswap dex lp remove --token-id 123 --collect-only"
  }
}
```

Error shape:

```json
{ "ok": false, "error": { "code": "BAW_PREVIEW_REJECTED", "message": "…" } }
```

If the preview contains `needsApproval`, execute the approval preview(s) first,
then re-run the original command to preview the dependent action. If the response
contains `orderedSteps` / `requiresSequentialExecution`, execute the steps in the
listed order and use each step's `nextCommand`; do not jump to the final step.
`next.recoveryAfterDecrease` is the command to use only after the decrease has
confirmed.

The local preview binding is stored in `AGENTSWAP_STATE_DIR` (default
`~/.agentswap/tx-journal.json`), together with execution records. A `requestId`
is not portable across machines or state directories: the same CLI/MCP process
environment must be able to read that state file. If you run preview and execute
in different containers or users, set the same `AGENTSWAP_STATE_DIR` for both.

### What `ok`, `executed`, and `requireConfirmation` mean

| Field | Means | Does not mean |
| --- | --- | --- |
| `ok: true` | The command produced a valid result | The transaction is confirmed on-chain |
| `executed: true` | `tx execute` accepted the request and called BAW | The transaction is necessarily broadcast or confirmed |
| `preview.requireConfirmation: true` | The Binance App may require an extra approval | The user has already approved the operation |
| `status: "PENDING_CONFIRMATION"` | BAW accepted the execute request but waits for App action | The transaction is complete |

`agentswap tx execute --confirm` is the user's explicit approval for this CLI
step. ERC-20 `needsApproval` is a token allowance, not a transaction approval.
Binance App confirmation is a separate wallet-side step. Use
`tx status --tx-hash` for broadcast/chain status.

## Commands

| Command | What it does |
| --- | --- |
| `agentswap doctor` | Read-only BSC + BAW + Agent ID health check. |
| `agentswap status` | Read-only chain, address-book, policy, and wallet snapshot. |
| `agentswap skill` | Print this package’s operational `SKILL.md` guide. |
| `agentswap token create` | Preview a fixed-supply gated token creation. |
| `agentswap token approve` | Preview an exact ERC-20 approval or revocation (`--amount 0`). |
| `agentswap dex pool create` | Preview a gated pool creation. |
| `agentswap dex lp add` | Preview a gated LP mint, or return required approval previews. |
| `agentswap dex lp remove` | Preview decrease → collect → burn for a position owned by the wallet. |
| `agentswap dex quote` | Read-only quote through the gated quoter. |
| `agentswap dex swap` | Preview an exact-input swap; supports native BNB input and `--native-out`. |
| `agentswap dex positions` | Read-only position list for an owner. |
| `agentswap tx execute` | Execute one previewed `requestId`; requires `--confirm`. |
| `agentswap tx status` | Query by `--tx-hash`, or by `--order-id` from the local execute journal. |

Use `--json` on any command for exactly one JSON object on stdout. Run `agentswap <command> --help` for flags and examples.

### Supported interfaces

The supported user interfaces are the `agentswap` CLI, the `agentswap-mcp`
server, and the `agentswap skill` guide. The JavaScript exports in `dist/`
(`main`, `types`, and `exports`) are implementation exports for these
interfaces, not a stable public API. Do not build a product integration against
those modules unless you are prepared to follow their internal changes.

### Parameter conventions

- `--token` and `--quote` are the two logical sides you name. On-chain they
  become `token0`/`token1` after sorting by address. `--amount0` and
  `--amount1` always refer to the **sorted** token0/token1, not to the
  `--token`/`--quote` order.
- `--amount0`, `--amount1`, `--amount-in`, and `--min-out` are **human units**
  (for example `1.5`). `--min-amount0` and `--min-amount1` are **raw base
  units** (for example `1500000` for 1.5 USDT with 6 decimals).
- Fee tiers: `100` = 0.01%, `500` = 0.05%, `3000` = 0.30%,
  `10000` = 1.00%.
- `dex quote --exact-out` means `--amount-in` is the **desired output**
  amount, despite the flag name. Without `--exact-out`, it is the input amount.
- `dex lp remove --liquidity 50%` is a partial decrease and requires
  `--no-burn`; omit `--liquidity` to remove 100%. After a decrease, use
  `--collect-only` to collect and optionally burn; do not re-run the decrease.

Example with USDT/WBNB:

- USDT `0x55d3…` sorts before WBNB `0xbb4C…`, so **token0 = USDT** and
  **token1 = WBNB**, regardless of the `--token`/`--quote` order.
- `--amount0 100` means 100 USDT (human units); `--min-amount0 99000000` is
  99 USDT in raw 6-decimal units.
- `--amount1 0.05` means 0.05 WBNB; `--min-amount1 49500000000000000` is
  0.0495 WBNB in raw 18-decimal units.
- For a quote, `--exact-out --amount-in 100` means “I want 100 units out”, not
  “I am putting 100 units in”.

Check the pool/position output or sort the addresses yourself before choosing
the numbers.

### LP actions and parameters

- **decreaseLiquidity** reduces a position's liquidity. The removed principal
  and fees become `tokensOwed0` / `tokensOwed1`; they are not transferred yet.
- **collect** transfers those owed tokens to a recipient. It is a separate
  transaction.
- **burn** destroys the position NFT. It only succeeds when liquidity is zero
  and both owed balances are zero; collect first.
- `tickLower` / `tickUpper` define the price range. They must be multiples of the
  pool's `tickSpacing`; read `tickSpacing`, `currentTick`, and token decimals from
  `agentswap dex positions` or the pool/token metadata. This CLI does not
  calculate ticks from a desired price.
- `amount0` / `amount1` are desired human amounts for sorted token0/token1;
  `minAmount0` / `minAmount1` are required raw base-unit floors.
- After a full decrease, `--collect-only` previews collect and burn. After a
  partial decrease, use `--no-burn` and collect later; do not re-run the decrease.

### One task, several commands

The CLI does not hide the transaction boundary. A typical sequence is:

1. `token create` preview → execute → status. The new token address comes from the
   `TokenCreated` event or the explorer/BAW transaction history, not from the
   preview's `token.address` field (which is `null` before creation).
2. `dex pool create` preview → execute → status. The pool address comes from the
   `GatedPoolCreated` event.
3. `dex lp add` uses the pool's token0/token1 order, fee, tick spacing, and your
   chosen tick range. `dex positions` lists existing token IDs for a later
   `dex lp remove`.

If you only want the protocol-level TypeScript walkthrough, use the Agentic
Protocol quickstart. The CLI is the transaction client; it does not replace event
indexing or a position dashboard.

### Key flags

- `--liquidity` (LP remove): full by default; raw uint128 amount or a percentage such as `50%`. Partial removal requires `--no-burn`.
- `--min-amount0` / `--min-amount1`: raw base-unit lower bounds. Required for LP add and for any LP remove that includes a decrease; they are encoded into the mint/decrease.
- `--collect-only` (LP remove): skip decrease and only collect/burn after a decrease has already executed. Use this for recovery; never re-run the original decrease command.
- `--native-out` (swap): `--token-out` must be `BNB`, `native`, `ETH`, or the `0xEeee…` sentinel. The router swaps to WBNB and unwraps it to BNB. BNB → BNB is rejected.
- `--min-out` (swap): minimum output in output-token units; for `--native-out`, BNB units.
- `--recipient`: output/position recipient; defaults to the Agentic Wallet.
- **Approvals that need a reset:** the CLI returns the reset preview first. Execute it, then re-run; it will not preview the dependent approve against stale state.

## Safety

- **No private keys.** There is no local signer, key file, or key argument. Binance Agentic Wallet is non-custodial and performs signing.
- **Preview first.** Token/pool/LP/swap/approve commands build calldata and call `baw contract-call preview`; they never broadcast.
- **Explicit execution only.** `agentswap tx execute --confirm` is the only execution path, and it consumes a local preview binding. If BAW returns `PENDING_CONFIRMATION`, confirm in the Binance App.
- **Local record vs live status.** `tx status --order-id` reports the last local record with an explicit freshness flag. The BAW contract-call flow has no orderId lookup; use `--tx-hash` for a live query.
- **Review risks.** Check `parsedTx`, `simulationResult`, `risks`, and `requireConfirmation` before executing.
- **Approvals are visible.** LP/swap return `needsApproval` previews when allowances are insufficient; they never silently approve.
- **Use small amounts on mainnet.** Test with amounts you can afford to lose.
- **Do not use this to move funds you cannot afford to lose.**

## BSC mainnet addresses (chain 56)

| Contract | Address |
| --- | --- |
| Agent ID registry (external) | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |
| AgenticPolicy | `0xdb7FA5F2DDEaCF0Dbd7cd8ACa12A43A1050D4Ff7` |
| AgenticTokenFactory | `0x0c05551Ba2d262e99616634111ef693716A986ce` |
| AgenticAssetRegistry | `0xe2e2280B7662918564AC900801Ba80292602B1a1` |
| AgenticQuoteAssetRegistry | `0x5F3D85574A4eaee8438a24Df147a6878937784Ce` |
| AgentswapPoolFactory | `0xEc281F077C643CaDd4Ca90724C287552ca3e84e7` |
| AgentswapV3Factory (canonical) | `0x83BC4672076BCb1167219fefC26089e45e75C813` |
| AgentswapPositionManager | `0x718204f0fb6A7ACD41D314abfD6331b43f502eC0` |
| AgentswapRouter | `0x460A4F74580369817c699A6F4fE3d2d2Ce1fef50` |
| AgentswapQuoter | `0xDB1874Adb5432ed3EC2153192c4243c64111AA5e` |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| USDT | `0x55d398326f99059fF775485246999027B3197955` |

The address book ships in `deployments/56.json`; the CLI reads it at startup.

## MCP server

Start the stdio MCP server:

```sh
npx -y -p @agentswap/cli@0.1.2 agentswap-mcp
```

Client configuration:

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

Read-only tools: `agentswap_doctor`, `agentswap_status`, `agentswap_dex_quote`, `agentswap_dex_positions`.
Preview tools: `agentswap_token_create`, `agentswap_token_approve`, `agentswap_dex_pool_create`, `agentswap_dex_lp_add`, `agentswap_dex_lp_remove`, `agentswap_dex_swap`.
Execute: `agentswap_tx_execute` requires `requestId` and `confirmed: true`.
Status: `agentswap_tx_status` accepts `orderId` or `txHash`.

Preview tools return structured JSON plus readable text and never broadcast. No key material is accepted as a tool argument. Execute separately after reviewing the preview; Binance App confirmation may be required.

## Environment

| Variable | Purpose |
| --- | --- |
| `AGENTSWAP_RPC_URL` | BSC RPC endpoint. Defaults to a public BSC endpoint. |
| `AGENTSWAP_STATE_DIR` | Directory for `tx-journal.json` (default `~/.agentswap`). It stores preview bindings and execution records; preview and execute must see the same directory. No credentials are stored. |

## Troubleshooting

| Symptom / code | Fix |
| --- | --- |
| `BAW_NOT_INSTALLED` | Install `@binance/agentic-wallet@1.12.0`; ensure `baw` is on `PATH`. |
| `BAW_UNAVAILABLE` / network or TLS error | Check network access and run `baw wallet status --json` again. |
| `BAW_NOT_CONNECTED` | Run `baw auth signin --json`, open `urlForWeb`, complete `baw auth verify --qrCodeId <qrCodeId> --json`, and approve in the Binance App. |
| `DEVMODE_REQUIRED` | Enable Developer Mode in the Binance App: Agentic Wallet → Settings → Developer Mode. |
| Agent ID ineligible | Check `baw wallet agent-id --json`; use the [Binance Agentic Wallet skill](https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/SKILL.md) for the claim flow, then re-run `agentswap doctor`. |
| `CONFIRM_REQUIRED` | Review the preview, then re-run `tx execute` with `--confirm`. |
| `PENDING_CONFIRMATION` | Approve or reject in the Binance App; obtain the txHash and use `tx status --tx-hash`. `--order-id` is local last-known only. |
| `ORDER_NOT_FOUND` | The local journal has no such order; use `--tx-hash` after broadcast. |
| `MIN_OUT_TOO_HIGH` | Lower `--min-out` or refresh the quote; the swap would revert. |
| `NATIVE_OUT_MISMATCH` | With `--native-out`, pass a native alias as `--token-out`. |
| `NATIVE_TO_NATIVE_UNSUPPORTED` | BNB → BNB is not a swap; use an ERC-20 input. |
| `BURN_REQUIRES_FULL_LIQUIDITY` | Remove 100% liquidity or pass `--no-burn`. |
| `NOT_POSITION_OWNER` | The position must be owned by the Agentic Wallet BSC address. |

## License

MIT.
