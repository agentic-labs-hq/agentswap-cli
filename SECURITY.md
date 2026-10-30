# Security

This package is a CLI/MCP client for Binance Agentic Wallet. It does not accept,
store, or derive private keys. Signing and final approval happen in Binance
Agentic Wallet / the Binance App.

## Reporting

Report suspected vulnerabilities privately. Prefer GitHub private vulnerability
reporting when it is enabled for this repository. If it is not available, email
`agentswap@proton.me`.

Do not open a public issue for an exploitable finding. Include the affected
version, command, impact, and reproduction steps. Do not send private keys,
seed phrases, or wallet credentials.

## Scope

- The published CLI/MCP package and its transaction-building logic.
- Preview/execute separation, approval handling, address book, and package
  contents.
- Dependency/supply-chain issues in the published package.

The protocol contracts have a separate security policy in the Agentic Protocol
repository. This package is not a smart-contract security review.
