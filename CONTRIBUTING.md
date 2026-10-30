# Contributing

This is the public Agentswap CLI/MCP package. Keep changes limited to the
end-user token, pool, LP, quote, and swap surface.

## Before a pull request

```sh
npm ci
npm run typecheck
npm test
npm run check:package
```

- Do not add private keys, seed phrases, signer code, or local file
  dependencies.
- Do not add facility creation/management commands; that is a builder
  integration in the Agentic Protocol repository.
- Do not add private deployment material (keys, signer state, RPC credentials) or unreleased product files. The public address book in `deployments/56.json` is allowed.
- Keep the package contents limited to `dist`, `deployments`, `SKILL.md`,
  `README.md`, and `LICENSE`.
- A published version is immutable; fixes require a new version.

Security reports should follow [`SECURITY.md`](SECURITY.md), not a public issue.
