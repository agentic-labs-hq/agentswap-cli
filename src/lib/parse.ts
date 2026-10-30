import { formatUnits, getAddress, isAddress, parseUnits, zeroAddress, type Address } from "viem";

import { CliError } from "../errors.js";

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const INTEGER_PATTERN = /^-?\d+$/;
const UINT_PATTERN = /^\d+$/;
const MAX_UINT256 = 2n ** 256n - 1n;

/** Parse a human decimal string into base units, rejecting negatives/exponents. */
export function parseAmount(value: string, decimals: number, label: string): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new CliError("INVALID_DECIMALS", `${label}: token decimals must be between 0 and 255.`);
  }
  if (typeof value !== "string" || value.length === 0 || !DECIMAL_PATTERN.test(value)) {
    throw new CliError("INVALID_AMOUNT", `${label} must be a positive decimal string such as "1" or "1.5".`);
  }
  const fraction = value.split(".")[1] ?? "";
  if (fraction.length > decimals) {
    throw new CliError("INVALID_AMOUNT", `${label} has more than ${decimals} decimal places.`);
  }
  let amount: bigint;
  try {
    amount = parseUnits(value, decimals);
  } catch (error) {
    throw new CliError("INVALID_AMOUNT", `${label} is not a valid amount.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (amount > MAX_UINT256) {
    throw new CliError("INVALID_AMOUNT", `${label} exceeds uint256.`);
  }
  return amount;
}

/** Parse a human decimal string and require a non-zero value. */
export function parsePositiveAmount(value: string, decimals: number, label: string): bigint {
  const amount = parseAmount(value, decimals, label);
  if (amount <= 0n) throw new CliError("INVALID_AMOUNT", `${label} must be greater than zero.`);
  return amount;
}

/** Parse a non-negative bigint string (e.g. sqrtPriceX96). */
export function parseBigIntString(value: string, label: string): bigint {
  if (!UINT_PATTERN.test(value)) {
    throw new CliError("INVALID_INTEGER", `${label} must be a non-negative integer.`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) throw new CliError("INVALID_INTEGER", `${label} exceeds uint256.`);
  return parsed;
}

/** Parse an integer and enforce inclusive bounds. */
export function parseInteger(
  value: string,
  label: string,
  bounds: { min?: number; max?: number } = {},
): number {
  if (!INTEGER_PATTERN.test(value)) {
    throw new CliError("INVALID_INTEGER", `${label} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new CliError("INVALID_INTEGER", `${label} is outside the safe integer range.`);
  if (bounds.min !== undefined && parsed < bounds.min) {
    throw new CliError("INVALID_INTEGER", `${label} must be >= ${bounds.min}.`);
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    throw new CliError("INVALID_INTEGER", `${label} must be <= ${bounds.max}.`);
  }
  return parsed;
}

export function parseAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new CliError("INVALID_ADDRESS", `${label} is not a valid EVM address.`);
  }
  let address: Address;
  try {
    address = getAddress(value);
  } catch {
    throw new CliError("INVALID_ADDRESS", `${label} has an invalid EIP-55 checksum; use all-lowercase or the checksummed address.`);
  }
  if (address === zeroAddress) throw new CliError("INVALID_ADDRESS", `${label} must not be the zero address.`);
  return address;
}

/** Parse repeated recipients, rejecting zero/duplicate addresses (case-insensitive). */
export function parseRecipients(values: readonly string[]): Address[] {
  if (values.length === 0) throw new CliError("INVALID_RECIPIENT", "At least one --recipient is required.");
  const recipients: Address[] = [];
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const address = parseAddress(value, `--recipient[${index}]`);
    const lower = address.toLowerCase();
    if (seen.has(lower)) throw new CliError("INVALID_RECIPIENT", `Duplicate recipient ${address}.`);
    seen.add(lower);
    recipients.push(address);
  });
  return recipients;
}

/** Split a fixed supply as evenly as possible; the remainder goes to the first recipient. */
export function splitSupply(total: bigint, count: number, label = "supply"): bigint[] {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new CliError("INVALID_RECIPIENT", "At least one recipient is required.");
  }
  if (total <= 0n) throw new CliError("INVALID_AMOUNT", `${label} must be greater than zero.`);
  const base = total / BigInt(count);
  if (base === 0n) {
    throw new CliError("INVALID_AMOUNT", `${label} is too small to split across ${count} recipients at 18 decimals.`);
  }
  const amounts = Array.from({ length: count }, () => base);
  amounts[0] = base + (total - base * BigInt(count));
  return amounts;
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  const formatted = formatUnits(amount, decimals);
  if (!formatted.includes(".")) return formatted;
  return formatted.replace(/\.?0+$/, "");
}

export function parseSlippageBps(value: string | undefined, fallback = 50): number {
  if (value === undefined) return fallback;
  return parseInteger(value, "--slippage-bps", { min: 0, max: 2000 });
}

export function parseDeadlineSeconds(value: string | undefined, fallback = 600): number {
  if (value === undefined) return fallback;
  return parseInteger(value, "--deadline (seconds from now)", { min: 30, max: 86400 });
}
