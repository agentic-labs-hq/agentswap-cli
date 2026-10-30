#!/usr/bin/env node
// Check the packed tarball contents without publishing.
// Usage: node scripts/check-package.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"]
});
const [result] = JSON.parse(raw);
const files = new Set(result.files.map((file) => file.path));

const required = [
  "dist/cli.js",
  "dist/mcp.js",
  "dist/index.js",
  "SKILL.md",
  "README.md",
  "LICENSE",
  "deployments/56.json"
];

for (const file of required) {
  if (!files.has(file)) {
    throw new Error(`missing package file: ${file}`);
  }
}

for (const file of files) {
  if (file.endsWith(".map")) {
    throw new Error(`source map must not be published: ${file}`);
  }
  if (/facility|launch|vault|lending|game|escrow|locker/i.test(file)) {
    throw new Error(`facility-related file must not be published: ${file}`);
  }
}

if (pkg.version !== "0.1.2") {
  throw new Error(`unexpected version: ${pkg.version}`);
}

console.log(`package check OK: ${result.entryCount} files, version ${pkg.version}`);
