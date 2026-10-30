import { CliError } from "../errors.js";

/** Uniswap V3 TickMath bounds (inclusive lower, exclusive upper). */
export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

const PRICE_PATTERN = /^\d+(?:\.\d+)?$/;
const MAX_PRICE_DECIMALS = 36;

/** Integer square root (floor) for non-negative bigints. */
export function isqrt(value: bigint): bigint {
  if (value < 0n) throw new CliError("INVALID_PRICE", "square root of a negative value");
  if (value < 2n) return value;
  let x0 = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  let x1 = (x0 + value / x0) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }
  return x0;
}

function parseDecimalFraction(value: string): { numerator: bigint; denominator: bigint } {
  if (typeof value !== "string" || !PRICE_PATTERN.test(value)) {
    throw new CliError("INVALID_PRICE", "price must be a positive decimal string such as \"1\" or \"0.00025\".");
  }
  const [integerPart = "0", fractionPart = ""] = value.split(".");
  if (fractionPart.length > MAX_PRICE_DECIMALS) {
    throw new CliError("INVALID_PRICE", `price supports at most ${MAX_PRICE_DECIMALS} decimal places.`);
  }
  const numerator = BigInt(`${integerPart}${fractionPart}`);
  const denominator = 10n ** BigInt(fractionPart.length);
  if (numerator === 0n) throw new CliError("INVALID_PRICE", "price must be greater than zero.");
  return { numerator, denominator };
}

/** Throw unless a sqrt price is inside the Uniswap V3 valid range. */
export function assertSqrtPriceX96(sqrtPriceX96: bigint, label = "sqrtPriceX96"): void {
  if (sqrtPriceX96 <= 0n) throw new CliError("INVALID_SQRT_PRICE", `${label} must be greater than zero.`);
  if (sqrtPriceX96 < MIN_SQRT_RATIO) {
    throw new CliError("INVALID_SQRT_PRICE", `${label} is below TickMath.MIN_SQRT_RATIO (${MIN_SQRT_RATIO}).`);
  }
  if (sqrtPriceX96 >= MAX_SQRT_RATIO) {
    throw new CliError("INVALID_SQRT_PRICE", `${label} is at or above TickMath.MAX_SQRT_RATIO.`);
  }
}

/**
 * Convert a human price into a Uniswap V3 `sqrtPriceX96`.
 *
 * `price` is quote-token units per one token unit (e.g. 0.00025 USDT per TOKEN).
 * The pool's raw price is token1/token0, so the conversion flips when `token`
 * sorts as token1 and adjusts for the two tokens' decimals.
 */
export function priceToSqrtPriceX96(params: {
  price: string;
  tokenDecimals: number;
  quoteDecimals: number;
  tokenIsToken0: boolean;
}): bigint {
  const { price, tokenDecimals, quoteDecimals, tokenIsToken0 } = params;
  for (const [label, decimals] of [
    ["tokenDecimals", tokenDecimals],
    ["quoteDecimals", quoteDecimals],
  ] as const) {
    if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new CliError("INVALID_DECIMALS", `${label} must be between 0 and 255.`);
    }
  }

  const { numerator, denominator } = parseDecimalFraction(price);
  let rawNumerator: bigint;
  let rawDenominator: bigint;

  if (tokenIsToken0) {
    // raw price = quote per token, scaled by 10^(quoteDecimals - tokenDecimals)
    const diff = quoteDecimals - tokenDecimals;
    if (diff >= 0) {
      rawNumerator = numerator * 10n ** BigInt(diff);
      rawDenominator = denominator;
    } else {
      rawNumerator = numerator;
      rawDenominator = denominator * 10n ** BigInt(-diff);
    }
  } else {
    // token is token1: raw price = token per quote = 10^(tokenDecimals - quoteDecimals) / price
    const diff = tokenDecimals - quoteDecimals;
    if (diff >= 0) {
      rawNumerator = denominator * 10n ** BigInt(diff);
      rawDenominator = numerator;
    } else {
      rawNumerator = denominator;
      rawDenominator = numerator * 10n ** BigInt(-diff);
    }
  }

  // floor(sqrt(rawNum/rawDen) * 2^96) == isqrt((rawNum << 192) / rawDen)
  const sqrtPriceX96 = isqrt((rawNumerator << 192n) / rawDenominator);
  assertSqrtPriceX96(sqrtPriceX96);
  return sqrtPriceX96;
}

/** Validate tick range and tick-spacing alignment for a pool. */
export function validateTickBounds(params: {
  tickLower: number;
  tickUpper: number;
  tickSpacing: number;
}): void {
  const { tickLower, tickUpper, tickSpacing } = params;
  if (!Number.isSafeInteger(tickSpacing) || tickSpacing <= 0) {
    throw new CliError("INVALID_TICK", "tick spacing must be a positive integer.");
  }
  for (const [label, tick] of [
    ["tickLower", tickLower],
    ["tickUpper", tickUpper],
  ] as const) {
    if (!Number.isSafeInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
      throw new CliError("INVALID_TICK", `${label} must be an integer in [${MIN_TICK}, ${MAX_TICK}].`);
    }
    if (tick % tickSpacing !== 0) {
      throw new CliError("INVALID_TICK", `${label} (${tick}) must be a multiple of tick spacing ${tickSpacing}.`);
    }
  }
  if (tickLower >= tickUpper) {
    throw new CliError("INVALID_TICK", "tickLower must be strictly less than tickUpper.");
  }
}
