import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import { CliError } from "../src/errors.js";
import { assertDistinctAddresses, isToken0, sameAddress, sortTokenPair } from "../src/lib/ordering.js";

const LOW = getAddress("0x1111111111111111111111111111111111111111");
const HIGH = getAddress("0x2222222222222222222222222222222222222222");

describe("token ordering", () => {
  it("sorts ascending by address", () => {
    expect(sortTokenPair(HIGH, LOW)).toEqual([LOW, HIGH]);
    expect(sortTokenPair(LOW, HIGH)).toEqual([LOW, HIGH]);
  });

  it("is case-insensitive and returns checksummed addresses", () => {
    expect(sortTokenPair(HIGH.toLowerCase() as `0x${string}`, LOW.toLowerCase() as `0x${string}`)).toEqual([LOW, HIGH]);
    expect(sameAddress(LOW, LOW.toLowerCase() as `0x${string}`)).toBe(true);
    expect(sameAddress(LOW, HIGH)).toBe(false);
  });

  it("identifies token0 for a pair", () => {
    expect(isToken0(LOW, HIGH)).toBe(true);
    expect(isToken0(HIGH, LOW)).toBe(false);
  });

  it("rejects identical tokens", () => {
    expect(() => sortTokenPair(LOW, LOW)).toThrowError(CliError);
    expect(() => assertDistinctAddresses(LOW, LOW.toLowerCase() as `0x${string}`)).toThrowError(CliError);
    expect(() => assertDistinctAddresses(LOW, HIGH)).not.toThrow();
  });
});
