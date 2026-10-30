import { describe, expect, it } from "vitest";

import { CliError } from "../src/errors.js";
import { parseLiquiditySelection, planLpRemove } from "../src/lib/liquidity.js";

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

describe("parseLiquiditySelection", () => {
  it("defaults to full liquidity", () => {
    expect(parseLiquiditySelection(undefined, 1000n)).toEqual({
      liquidity: 1000n,
      mode: "full",
      requested: null,
      percent: null,
    });
  });

  it("parses percentages and floors the result", () => {
    expect(parseLiquiditySelection("50%", 1000n)).toMatchObject({ liquidity: 500n, mode: "percent", percent: "50" });
    expect(parseLiquiditySelection("12.5%", 1000n)).toMatchObject({ liquidity: 125n, mode: "percent" });
    expect(parseLiquiditySelection("33.333%", 1000n)).toMatchObject({ liquidity: 333n, mode: "percent" });
    expect(parseLiquiditySelection("100%", 1000n)).toMatchObject({ liquidity: 1000n, mode: "full" });
  });

  it("parses raw uint128 amounts", () => {
    expect(parseLiquiditySelection("400", 1000n)).toMatchObject({ liquidity: 400n, mode: "raw", requested: "400" });
    expect(parseLiquiditySelection("1000", 1000n)).toMatchObject({ liquidity: 1000n, mode: "full" });
  });

  it("rejects invalid, zero, over-100%, too-small, and oversized values", () => {
    for (const value of ["", "0", "0%", "-1", "1.5", "101%", "abc", "1e3", "0x10"]) {
      expectCode(() => parseLiquiditySelection(value, 1000n), "INVALID_LIQUIDITY");
    }
    expectCode(() => parseLiquiditySelection("1001", 1000n), "LIQUIDITY_TOO_LARGE");
    expectCode(() => parseLiquiditySelection("0.01%", 100n), "INVALID_LIQUIDITY");
    expectCode(() => parseLiquiditySelection("50%", 0n), "NO_LIQUIDITY");
  });
});

describe("planLpRemove", () => {
  it("defaults to full liquidity, collect, and burn", () => {
    const plan = planLpRemove({ currentLiquidity: 1000n, noCollect: false, noBurn: false });
    expect(plan.selection.liquidity).toBe(1000n);
    expect(plan.remainingLiquidity).toBe(0n);
    expect(plan.steps.map((step) => step.kind)).toEqual(["decrease", "collect", "burn"]);
  });

  it("supports partial removal when burn is disabled", () => {
    const plan = planLpRemove({
      currentLiquidity: 1000n,
      requested: "50%",
      noCollect: false,
      noBurn: true,
    });
    expect(plan.selection.liquidity).toBe(500n);
    expect(plan.remainingLiquidity).toBe(500n);
    expect(plan.steps.map((step) => step.kind)).toEqual(["decrease", "collect"]);
  });

  it("rejects partial removal with burn enabled", () => {
    expectCode(
      () => planLpRemove({ currentLiquidity: 1000n, requested: "50%", noCollect: false, noBurn: false }),
      "BURN_REQUIRES_FULL_LIQUIDITY",
    );
  });

  it("skips decrease when liquidity is already zero", () => {
    const plan = planLpRemove({ currentLiquidity: 0n, noCollect: false, noBurn: false });
    expect(plan.steps.map((step) => step.kind)).toEqual(["collect", "burn"]);
    expect(plan.remainingLiquidity).toBe(0n);
  });

  it("supports collect-only and zero-owed burn plans", () => {
    expect(planLpRemove({ currentLiquidity: 0n, noCollect: false, noBurn: true }).steps.map((step) => step.kind)).toEqual([
      "collect",
    ]);
    expect(planLpRemove({ currentLiquidity: 0n, noCollect: true, noBurn: false }).steps.map((step) => step.kind)).toEqual([
      "burn",
    ]);
  });

  it("rejects an empty plan", () => {
    expectCode(
      () => planLpRemove({ currentLiquidity: 0n, noCollect: true, noBurn: true }),
      "NOTHING_TO_DO",
    );
  });

  it("allows decrease-only plans", () => {
    const plan = planLpRemove({ currentLiquidity: 1000n, noCollect: true, noBurn: true });
    expect(plan.steps.map((step) => step.kind)).toEqual(["decrease"]);
  });
});
