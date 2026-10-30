import { describe, expect, it } from "vitest";

import { CliError } from "../src/errors.js";
import {
  assertPositive,
  validateFeeTier,
  validateMetadataUri,
  validateRecipientCount,
  validateTokenName,
  validateTokenSymbol,
} from "../src/lib/validate.js";

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("token metadata validation", () => {
  it("accepts reasonable names, symbols, and metadata URIs", () => {
    expect(() => validateTokenName("Example Agent Token")).not.toThrow();
    expect(() => validateTokenSymbol("EGT")).not.toThrow();
    expect(() => validateTokenSymbol("EGT-2")).not.toThrow();
    expect(() => validateMetadataUri("ipfs://bafy.../token.json")).not.toThrow();
  });

  it("rejects empty, too long, spaced, or control-character values", () => {
    expectCode(() => validateTokenName(""), "INVALID_NAME");
    expectCode(() => validateTokenName("x".repeat(65)), "INVALID_NAME");
    expectCode(() => validateTokenName(" padded"), "INVALID_NAME");
    expectCode(() => validateTokenName("bad\ntoken"), "INVALID_NAME");
    expectCode(() => validateTokenSymbol(""), "INVALID_SYMBOL");
    expectCode(() => validateTokenSymbol("x".repeat(17)), "INVALID_SYMBOL");
    expectCode(() => validateTokenSymbol("BAD SYMBOL"), "INVALID_SYMBOL");
    expectCode(() => validateMetadataUri(""), "INVALID_METADATA_URI");
    expectCode(() => validateMetadataUri("ipfs://a b"), "INVALID_METADATA_URI");
    expectCode(() => validateMetadataUri("x".repeat(2049)), "INVALID_METADATA_URI");
  });
});

describe("fee and recipient validation", () => {
  it("accepts uint24 fee tiers and rejects invalid ones", () => {
    for (const fee of [100, 500, 3000, 10000, 0xffffff]) {
      expect(() => validateFeeTier(fee)).not.toThrow();
    }
    for (const fee of [0, -1, 1.5, 0x1000000]) {
      expectCode(() => validateFeeTier(fee), "INVALID_FEE");
    }
  });

  it("enforces the factory recipient maximum", () => {
    expect(() => validateRecipientCount(1, 8n)).not.toThrow();
    expect(() => validateRecipientCount(8, 8n)).not.toThrow();
    expectCode(() => validateRecipientCount(9, 8n), "INVALID_RECIPIENT");
    expectCode(() => validateRecipientCount(0, 8n), "INVALID_RECIPIENT");
  });

  it("rejects non-positive amounts", () => {
    expect(() => assertPositive(1n, "amount")).not.toThrow();
    expectCode(() => assertPositive(0n, "amount"), "INVALID_AMOUNT");
  });
});
