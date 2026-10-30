import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FORBIDDEN_KEY_ENV = `AGENTSWAP_${"PRIVATE"}_KEY`;

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function sourceFiles(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(join(ROOT, directory))) {
    const path = join(ROOT, directory, entry);
    if (statSync(path).isDirectory()) output.push(...sourceFiles(relative(ROOT, path)));
    else if (entry.endsWith(".ts")) output.push(relative(ROOT, path));
  }
  return output;
}

const RAW_KEY_PATTERN = /0x[0-9a-fA-F]{64}/;
const ABSOLUTE_LOCAL_PATH = /\/(?:Users|home)\/|[A-Za-z]:\\Users\\/;

describe("public packaging", () => {
  it("declares the expected package name and both bins", () => {
    const pkg = JSON.parse(read("package.json")) as {
      name: string;
      version: string;
      private?: boolean;
      bin: Record<string, string>;
      files: string[];
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe("@agentswap/cli");
    expect(pkg.version).toBe("0.1.2");
    expect(pkg.private).toBe(false);
    expect(pkg.bin.agentswap).toBe("dist/cli.js");
    expect(pkg.bin["agentswap-mcp"]).toBe("dist/mcp.js");
    expect(pkg.bin).not.toHaveProperty("agentic");
    expect(pkg.bin).not.toHaveProperty("agentic-mcp");
    for (const entry of ["dist", "deployments", "SKILL.md", "README.md", "LICENSE"]) {
      expect(pkg.files).toContain(entry);
    }
    expect(pkg.dependencies).not.toHaveProperty("@agentic-protocol/sdk");
    expect(pkg.dependencies).not.toHaveProperty("@agentswap/sdk");
  });

  it("documents the Binance Agentic Wallet flow without signer instructions", () => {
    const skill = read("SKILL.md");
    for (const expected of [
      "Binance Agentic Wallet",
      "baw",
      "Developer Mode",
      "Binance App",
      "requestId",
      "Agentswap CLI",
      "Gated DEX for Agent ID assets, built on Agentic Protocol.",
      "agentswap tx execute",
      "agentswap_doctor",
      "agentswap_status",
      "agentswap_token_create",
      "agentswap_token_approve",
      "agentswap_dex_pool_create",
      "agentswap_dex_lp_add",
      "agentswap_dex_lp_remove",
      "agentswap_dex_quote",
      "agentswap_dex_swap",
      "agentswap_dex_positions",
      "agentswap_tx_execute",
      "agentswap_tx_status",
      "dex lp remove",
      "--native-out",
      "needsApproval",
      "npx",
    ]) {
      expect(skill).toContain(expected);
    }
    expect(skill).not.toMatch(ABSOLUTE_LOCAL_PATH);
    expect(skill).not.toContain(FORBIDDEN_KEY_ENV);
    expect(skill).not.toMatch(RAW_KEY_PATTERN);
  });

  it("prints a root SKILL.md guide for agentswap skill", () => {
    const skill = read("SKILL.md");
    expect(skill).toContain("agentswap doctor");
    expect(skill).toContain("npx -y @agentswap/cli@0.1.2");
    expect(skill).toContain("Binance App");
  });

  it("keeps README/help free of absolute local paths and signer env vars", () => {
    for (const path of ["README.md", "src/help.ts", "src/mcp.ts"]) {
      const content = read(path);
      expect(content, path).not.toMatch(ABSOLUTE_LOCAL_PATH);
      expect(content, path).not.toContain(FORBIDDEN_KEY_ENV);
    }
  });

  it("contains no signer code, local SDK dependency, or removed flags in src", () => {
    for (const path of sourceFiles("src")) {
      const content = read(path);
      for (const forbidden of [
        FORBIDDEN_KEY_ENV,
        ["private", "KeyToAccount"].join(""),
        ["wallet", "Client"].join(""),
        "--broadcast",
        "--dry-run",
        "--max-spend",
        "@agentic-protocol/sdk",
        "@agentswap/sdk",
        "agentic-mcp",
      ]) {
        expect(content, `${path} contains ${forbidden}`).not.toContain(forbidden);
      }
      expect(content, path).not.toMatch(RAW_KEY_PATTERN);
    }
  });

  it("keeps package metadata and docs free of local paths/file dependencies", () => {
    for (const path of ["package.json", "README.md", "SKILL.md"]) {
      const content = read(path);
      expect(content, path).not.toContain("file:../");
      expect(content, path).not.toContain("/Users/");
    }
  });

  it("ships no key-like files at the repository root", () => {
    const files = readdirSync(ROOT).filter((entry) => statSync(join(ROOT, entry)).isFile());
    expect(files.filter((entry) => /\.(env|key|pem|p12|keystore)$/i.test(entry))).toEqual([]);
  });

  it("keeps the deployment address book complete", () => {
    const deployment = JSON.parse(read("deployments/56.json")) as Record<string, unknown>;
    expect(deployment.chainId).toBe(56);
    for (const key of [
      "tokenFactory",
      "assetRegistry",
      "quoteAssetRegistry",
      "venueRegistry",
      "policyRegistry",
      "facilityFactory",
      "protocolTreasury",
      "gatedPoolFactory",
      "canonicalFactory",
      "positionManager",
      "swapRouter",
      "quoter",
      "policy",
      "identityAdapter",
      "agentIdRegistry",
      "nftDescriptor",
      "positionDescriptor",
      "wbnb",
      "usdt",
    ]) {
      expect(deployment, key).toHaveProperty(key);
    }
    expect(deployment.quoteTokens).toEqual([deployment.wbnb, deployment.usdt]);
  });
});
