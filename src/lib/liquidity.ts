import { CliError } from "../errors.js";

export type LiquidityMode = "full" | "percent" | "raw";

export interface LiquiditySelection {
  liquidity: bigint;
  mode: LiquidityMode;
  requested: string | null;
  percent: string | null;
}

const PERCENT_PATTERN = /^\d+(?:\.\d+)?%$/;
const RAW_PATTERN = /^\d+$/;
const MAX_PERCENT_DECIMALS = 18;

/**
 * Parse `--liquidity` for LP removal.
 * - omitted -> full current liquidity
 * - `50%` / `12.5%` -> percentage of current liquidity (floor)
 * - `123456` -> raw uint128 liquidity amount
 */
export function parseLiquiditySelection(value: string | undefined, current: bigint): LiquiditySelection {
  if (value === undefined) {
    return { liquidity: current, mode: "full", requested: null, percent: null };
  }
  const requested = value.trim();
  if (requested === "") throw new CliError("INVALID_LIQUIDITY", "--liquidity must not be empty.");

  if (requested.endsWith("%")) {
    if (!PERCENT_PATTERN.test(requested)) {
      throw new CliError("INVALID_LIQUIDITY", "--liquidity percent must look like \"50%\" or \"12.5%\".");
    }
    if (current === 0n) {
      throw new CliError("NO_LIQUIDITY", "The position already has zero liquidity; omit --liquidity to collect/burn.");
    }
    const percent = requested.slice(0, -1);
    const [integerPart = "0", fractionPart = ""] = percent.split(".");
    if (fractionPart.length > MAX_PERCENT_DECIMALS) {
      throw new CliError("INVALID_LIQUIDITY", `--liquidity percent supports at most ${MAX_PERCENT_DECIMALS} decimals.`);
    }
    const numerator = BigInt(`${integerPart}${fractionPart}`);
    if (numerator <= 0n) throw new CliError("INVALID_LIQUIDITY", "--liquidity must be greater than zero.");
    const denominator = 10n ** BigInt(fractionPart.length) * 100n;
    if (numerator > denominator) throw new CliError("INVALID_LIQUIDITY", "--liquidity percent must be at most 100%.");
    const liquidity = (current * numerator) / denominator;
    if (liquidity === 0n) {
      throw new CliError("INVALID_LIQUIDITY", "--liquidity percent is too small to remove a base unit.");
    }
    return {
      liquidity,
      mode: liquidity === current ? "full" : "percent",
      requested,
      percent,
    };
  }

  if (!RAW_PATTERN.test(requested)) {
    throw new CliError("INVALID_LIQUIDITY", "--liquidity must be a raw integer or a percentage such as \"50%\".");
  }
  const liquidity = BigInt(requested);
  if (liquidity <= 0n) throw new CliError("INVALID_LIQUIDITY", "--liquidity must be greater than zero.");
  if (liquidity > current) {
    throw new CliError(
      "LIQUIDITY_TOO_LARGE",
      `--liquidity ${liquidity} exceeds the position's current liquidity ${current}.`,
    );
  }
  return {
    liquidity,
    mode: liquidity === current ? "full" : "raw",
    requested,
    percent: null,
  };
}

export type LpRemoveStepKind = "decrease" | "collect" | "burn";

export interface LpRemovePlan {
  selection: LiquiditySelection;
  remainingLiquidity: bigint;
  steps: Array<{ kind: LpRemoveStepKind; description: string }>;
}

export interface LpRemovePlanParams {
  currentLiquidity: bigint;
  requested?: string;
  noCollect: boolean;
  noBurn: boolean;
  collectOnly?: boolean;
}

/**
 * Validate the removal plan before any preview:
 * - default full liquidity + collect + burn
 * - partial liquidity requires --no-burn (burn reverts unless liquidity is 0)
 * - when current liquidity is already 0, skip the decrease step so the same
 *   command can preview collect/burn after a prior decrease has confirmed.
 */
export function planLpRemove(params: LpRemovePlanParams): LpRemovePlan {

  if (params.collectOnly === true) {
    if (params.noCollect === true) {
      throw new CliError("NOTHING_TO_DO", "--collect-only cannot be combined with --no-collect.");
    }
    const steps: LpRemovePlan["steps"] = [
      { kind: "collect", description: "collect max token0/token1 owed to the Agentic Wallet" },
    ];
    if (!params.noBurn && params.currentLiquidity === 0n) {
      steps.push({ kind: "burn", description: "burn the position NFT" });
    }
    return {
      selection: { liquidity: 0n, mode: "full", requested: null, percent: null },
      remainingLiquidity: params.currentLiquidity,
      steps,
    };
  }

  const selection = parseLiquiditySelection(params.requested, params.currentLiquidity);
  if (!params.noBurn && params.currentLiquidity > 0n && selection.liquidity < params.currentLiquidity) {
    throw new CliError(
      "BURN_REQUIRES_FULL_LIQUIDITY",
      "Partial liquidity removal cannot burn the NFT; pass --no-burn or remove 100% of liquidity.",
    );
  }

  const steps: LpRemovePlan["steps"] = [];
  if (params.currentLiquidity > 0n && selection.liquidity > 0n) {
    steps.push({
      kind: "decrease",
      description: `decreaseLiquidity ${selection.liquidity} of ${params.currentLiquidity}`,
    });
  }
  if (!params.noCollect) {
    steps.push({ kind: "collect", description: "collect max token0/token1 owed to the Agentic Wallet" });
  }
  if (!params.noBurn) {
    steps.push({ kind: "burn", description: "burn the position NFT" });
  }
  if (steps.length === 0) {
    throw new CliError("NOTHING_TO_DO", "No removal steps selected (--no-collect and --no-burn with zero liquidity).");
  }

  return {
    selection,
    remainingLiquidity: params.currentLiquidity - selection.liquidity,
    steps,
  };
}
