import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import { planApprovals } from "../src/lib/approvals.js";

const TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN2 = "0x2222222222222222222222222222222222222222" as Address;
const SPENDER = "0x3333333333333333333333333333333333333333" as Address;

describe("planApprovals", () => {
  it("returns no steps when allowances are sufficient or amounts are zero", () => {
    expect(
      planApprovals(SPENDER, [
        { token: TOKEN, symbol: "T", allowance: 100n, amount: 100n, gated: true },
        { token: TOKEN2, symbol: "T2", allowance: 0n, amount: 0n, gated: false },
      ]),
    ).toEqual([]);
  });

  it("plans one exact approve when allowance is zero", () => {
    const steps = planApprovals(SPENDER, [
      { token: TOKEN, symbol: "T", allowance: 0n, amount: 100n, gated: true },
    ]);
    expect(steps).toEqual([
      {
        kind: "approve",
        token: TOKEN,
        symbol: "T",
        spender: SPENDER,
        amount: 100n,
        resetFirst: false,
        reason: "exact allowance for the operation",
      },
    ]);
  });

  it("approves a gated token directly when a non-zero allowance is insufficient", () => {
    const steps = planApprovals(SPENDER, [
      { token: TOKEN, symbol: "T", allowance: 30n, amount: 100n, gated: true },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "approve", amount: 100n, resetFirst: false });
  });

  it("resets a non-gated non-zero allowance before approving (USDT-style)", () => {
    const steps = planApprovals(SPENDER, [
      { token: TOKEN, symbol: "USDT", allowance: 30n, amount: 100n, gated: false },
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ kind: "reset", amount: 0n });
    expect(steps[1]).toMatchObject({ kind: "approve", amount: 100n, resetFirst: true });
  });

  it("keeps asset order and skips sufficient sides", () => {
    const steps = planApprovals(SPENDER, [
      { token: TOKEN, symbol: "A", allowance: 100n, amount: 50n, gated: true },
      { token: TOKEN2, symbol: "B", allowance: 0n, amount: 25n, gated: true },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.token).toBe(TOKEN2);
  });
});
