import { CliError } from "../errors.js";

const CONTROL_OR_SPACE = /[\u0000-\u001f\u007f\s]/u;

export function validateTokenName(name: string): void {
  const length = [...name].length;
  if (length < 1 || length > 64) throw new CliError("INVALID_NAME", "token name must be 1-64 characters.");
  if (name !== name.trim()) throw new CliError("INVALID_NAME", "token name must not have leading or trailing whitespace.");
  if (/[\u0000-\u001f\u007f]/u.test(name)) throw new CliError("INVALID_NAME", "token name must not contain control characters.");
}

export function validateTokenSymbol(symbol: string): void {
  const length = [...symbol].length;
  if (length < 1 || length > 16) throw new CliError("INVALID_SYMBOL", "token symbol must be 1-16 characters.");
  if (CONTROL_OR_SPACE.test(symbol)) throw new CliError("INVALID_SYMBOL", "token symbol must not contain spaces or control characters.");
}

export function validateMetadataUri(uri: string): void {
  const length = [...uri].length;
  if (length < 1 || length > 2048) throw new CliError("INVALID_METADATA_URI", "metadata URI must be 1-2048 characters.");
  if (CONTROL_OR_SPACE.test(uri)) throw new CliError("INVALID_METADATA_URI", "metadata URI must not contain whitespace or control characters.");
}

export function validateFeeTier(fee: number): void {
  if (!Number.isSafeInteger(fee) || fee <= 0 || fee > 0xffffff) {
    throw new CliError("INVALID_FEE", "fee must be a positive uint24 (for example 100, 500, 3000, or 10000).");
  }
}

export function validateRecipientCount(count: number, maxRecipients: bigint): void {
  if (count < 1) throw new CliError("INVALID_RECIPIENT", "at least one recipient is required.");
  if (BigInt(count) > maxRecipients) {
    throw new CliError("INVALID_RECIPIENT", `recipient count ${count} exceeds the factory maximum of ${maxRecipients}.`);
  }
}

export function assertPositive(amount: bigint, label: string): void {
  if (amount <= 0n) throw new CliError("INVALID_AMOUNT", `${label} must be greater than zero.`);
}
