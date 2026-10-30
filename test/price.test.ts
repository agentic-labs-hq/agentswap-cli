import { describe, expect, it } from "vitest";

import { CliError } from "../src/errors.js";
import {
  assertSqrtPriceX96,
  isqrt,
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  priceToSqrtPriceX96,
  validateTickBounds,
} from "../src/lib/price.js";

const Q96 = 2n ** 96n;

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

describe("isqrt", () => {
  it("computes floor square roots", () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(2n)).toBe(1n);
    expect(isqrt(3n)).toBe(1n);
    expect(isqrt(4n)).toBe(2n);
    expect(isqrt(15n)).toBe(3n);
    expect(isqrt(16n)).toBe(4n);
    expect(isqrt(17n)).toBe(4n);
    expect(isqrt(Q96 * Q96)).toBe(Q96);
  });
});

describe("priceToSqrtPriceX96", () => {
  it("maps 1:1 to Q96 for equal decimals", () => {
    expect(
      priceToSqrtPriceX96({ price: "1", tokenDecimals: 18, quoteDecimals: 18, tokenIsToken0: true }),
    ).toBe(Q96);
  });

  it("takes the square root of the human price", () => {
    expect(
      priceToSqrtPriceX96({ price: "4", tokenDecimals: 18, quoteDecimals: 18, tokenIsToken0: true }),
    ).toBe(2n * Q96);
    expect(
      priceToSqrtPriceX96({ price: "0.25", tokenDecimals: 18, quoteDecimals: 18, tokenIsToken0: true }),
    ).toBe(Q96 / 2n);
  });

  it("inverts the price when the token sorts as token1", () => {
    expect(
      priceToSqrtPriceX96({ price: "4", tokenDecimals: 18, quoteDecimals: 18, tokenIsToken0: false }),
    ).toBe(Q96 / 2n);
    expect(
      priceToSqrtPriceX96({ price: "0.25", tokenDecimals: 18, quoteDecimals: 18, tokenIsToken0: false }),
    ).toBe(2n * Q96);
  });

  it("adjusts for differing decimals", () => {
    // token0 18 decimals, quote 6 decimals, price 1 -> raw price 1e-12
    expect(
      priceToSqrtPriceX96({ price: "1", tokenDecimals: 18, quoteDecimals: 6, tokenIsToken0: true }),
    ).toBe(79_228_162_514_264_337_593_543n);
    // token is token1: raw price 1e12
    expect(
      priceToSqrtPriceX96({ price: "1", tokenDecimals: 18, quoteDecimals: 6, tokenIsToken0: false }),
    ).toBe(79_228_162_514_264_337_593_543_950_336_000_000n);
  });

  it("rejects bad prices and out-of-range results", () => {
    for (const price of ["0", "-1", "1e3", "abc", ""]) {
      expectCode(
        () => priceToSqrtPriceX96({ price, tokenDecimals: 18, quoteDecimals: 18, tokenIsToken0: true }),
        "INVALID_PRICE",
      );
    }
    const huge = `1${"0".repeat(40)}`;
    expectCode(
      () => priceToSqrtPriceX96({ price: huge, tokenDecimals: 18, quoteDecimals: 18, tokenIsToken0: true }),
      "INVALID_SQRT_PRICE",
    );
  });
});

describe("sqrt price range", () => {
  it("accepts the inclusive lower and excludes the upper bound", () => {
    expect(() => assertSqrtPriceX96(MIN_SQRT_RATIO)).not.toThrow();
    expect(() => assertSqrtPriceX96(MAX_SQRT_RATIO - 1n)).not.toThrow();
    expectCode(() => assertSqrtPriceX96(0n), "INVALID_SQRT_PRICE");
    expectCode(() => assertSqrtPriceX96(MIN_SQRT_RATIO - 1n), "INVALID_SQRT_PRICE");
    expectCode(() => assertSqrtPriceX96(MAX_SQRT_RATIO), "INVALID_SQRT_PRICE");
  });
});

describe("validateTickBounds", () => {
  it("accepts aligned ticks within TickMath limits", () => {
    expect(() => validateTickBounds({ tickLower: -887220, tickUpper: 887220, tickSpacing: 60 })).not.toThrow();
    expect(() => validateTickBounds({ tickLower: MIN_TICK, tickUpper: MAX_TICK, tickSpacing: 1 })).not.toThrow();
  });

  it("rejects misaligned, inverted, out-of-range, and zero-spacing ticks", () => {
    expectCode(() => validateTickBounds({ tickLower: -887221, tickUpper: 887220, tickSpacing: 60 }), "INVALID_TICK");
    expectCode(() => validateTickBounds({ tickLower: 60, tickUpper: 60, tickSpacing: 60 }), "INVALID_TICK");
    expectCode(() => validateTickBounds({ tickLower: -887220, tickUpper: 887220, tickSpacing: 0 }), "INVALID_TICK");
    expectCode(() => validateTickBounds({ tickLower: -887280, tickUpper: 887220, tickSpacing: 60 }), "INVALID_TICK");
    expectCode(() => validateTickBounds({ tickLower: 0, tickUpper: 887280, tickSpacing: 60 }), "INVALID_TICK");
  });
});
