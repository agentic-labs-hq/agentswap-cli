import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import { CliError } from "../src/errors.js";
import {
  formatTokenAmount,
  parseAddress,
  parseAmount,
  parseBigIntString,
  parseDeadlineSeconds,
  parseInteger,
  parsePositiveAmount,
  parseRecipients,
  parseSlippageBps,
  splitSupply,
} from "../src/lib/parse.js";

const AGENT = getAddress("0x1111111111111111111111111111111111111111");
const AGENT2 = getAddress("0x2222222222222222222222222222222222222222");

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

describe("parseAmount", () => {
  it("parses integer and fractional human amounts", () => {
    expect(parseAmount("1", 18, "amount")).toBe(10n ** 18n);
    expect(parseAmount("1.5", 6, "amount")).toBe(1_500_000n);
    expect(parseAmount("0.000001", 6, "amount")).toBe(1n);
    expect(parseAmount("0001.25", 2, "amount")).toBe(125n);
    expect(parseAmount("0", 18, "amount")).toBe(0n);
  });

  it("rejects malformed, negative, exponent, comma, and over-precise values", () => {
    for (const value of ["", "-1", "1e3", "1,000", ".5", "1.", " 1", "NaN"]) {
      expectCode(() => parseAmount(value, 18, "amount"), "INVALID_AMOUNT");
    }
    expectCode(() => parseAmount("1.0000000", 6, "amount"), "INVALID_AMOUNT");
    expectCode(() => parseAmount("1", -1, "amount"), "INVALID_DECIMALS");
  });

  it("requires positive amounts when asked", () => {
    expect(parsePositiveAmount("0.1", 18, "amount")).toBe(10n ** 17n);
    expectCode(() => parsePositiveAmount("0", 18, "amount"), "INVALID_AMOUNT");
  });
});

describe("splitSupply", () => {
  it("splits evenly and gives the remainder to the first recipient", () => {
    expect(splitSupply(100n, 3)).toEqual([34n, 33n, 33n]);
    expect(splitSupply(10n, 2)).toEqual([5n, 5n]);
    expect(splitSupply(7n, 7)).toEqual([1n, 1n, 1n, 1n, 1n, 1n, 1n]);
  });

  it("rejects supply too small to give every recipient a base unit", () => {
    expectCode(() => splitSupply(2n, 3), "INVALID_AMOUNT");
  });
});

describe("addresses and recipients", () => {
  it("normalizes addresses and rejects zero/invalid", () => {
    expect(parseAddress("0x1111111111111111111111111111111111111111", "recipient")).toBe(AGENT);
    expectCode(() => parseAddress("0x1234", "recipient"), "INVALID_ADDRESS");
    expectCode(() => parseAddress("0x0000000000000000000000000000000000000000", "recipient"), "INVALID_ADDRESS");
  });

  it("rejects duplicate recipients case-insensitively", () => {
    expect(parseRecipients([AGENT.toLowerCase(), AGENT2])).toEqual([AGENT, AGENT2]);
    expectCode(() => parseRecipients([AGENT, AGENT.toLowerCase()]), "INVALID_RECIPIENT");
    expectCode(() => parseRecipients([]), "INVALID_RECIPIENT");
  });
});

describe("integer and cap parsing", () => {
  it("parses bounded integers", () => {
    expect(parseInteger("-60", "tick", { min: -100, max: 100 })).toBe(-60);
    expectCode(() => parseInteger("-101", "tick", { min: -100 }), "INVALID_INTEGER");
    expectCode(() => parseInteger("1.5", "tick"), "INVALID_INTEGER");
  });

  it("parses uint strings and rejects negatives", () => {
    expect(parseBigIntString("79228162514264337593543950336", "sqrt")).toBe(2n ** 96n);
    expectCode(() => parseBigIntString("-1", "sqrt"), "INVALID_INTEGER");
  });

  it("parses slippage and deadline with safe bounds", () => {
    expect(parseSlippageBps(undefined)).toBe(50);
    expect(parseSlippageBps("0")).toBe(0);
    expectCode(() => parseSlippageBps("2001"), "INVALID_INTEGER");
    expect(parseDeadlineSeconds(undefined)).toBe(600);
    expect(parseDeadlineSeconds("30")).toBe(30);
    expectCode(() => parseDeadlineSeconds("29"), "INVALID_INTEGER");
  });
});

describe("formatTokenAmount", () => {
  it("trims trailing zeros without losing precision", () => {
    expect(formatTokenAmount(0n, 18)).toBe("0");
    expect(formatTokenAmount(10n ** 18n, 18)).toBe("1");
    expect(formatTokenAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatTokenAmount(1n, 18)).toBe("0.000000000000000001");
  });
});
