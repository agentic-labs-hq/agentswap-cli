import {
  concat,
  decodeEventLog,
  getAddress,
  toHex,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import {
  agentswapPoolFactoryAbi,
  agentswapPositionManagerAbi,
  agentswapQuoterAbi,
  agentswapRouterAbi,
  uniswapV3FactoryAbi,
  uniswapV3PoolAbi,
} from "./abi/index.js";
import { readContractValue, sendContract, type SdkContext } from "./context.js";
import { SdkError } from "./errors.js";

/** Sort a token pair the way Uniswap V3 does (ascending address). */
export function sortTokenPair(tokenA: Address, tokenB: Address): [Address, Address] {
  const a = getAddress(tokenA);
  const b = getAddress(tokenB);
  if (a.toLowerCase() === b.toLowerCase()) throw new SdkError("tokenA and tokenB must differ.");
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

/**
 * Encode a Uniswap V3 path: `token + fee + token + fee + token ...`.
 * Fee values are packed as 3-byte big-endian integers.
 */
export function encodeSwapPath(tokens: readonly Address[], fees: readonly number[]): Hex {
  if (tokens.length < 2) throw new SdkError("A swap path needs at least two tokens.");
  if (fees.length !== tokens.length - 1) {
    throw new SdkError(`A swap path needs ${tokens.length - 1} fee(s), got ${fees.length}.`);
  }
  const parts: Hex[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    parts.push(getAddress(tokens[i]!));
    if (i < fees.length) {
      const fee = fees[i]!;
      if (!Number.isInteger(fee) || fee < 0 || fee > 0xffffff) {
        throw new SdkError(`Fee ${fee} is not a uint24.`);
      }
      parts.push(toHex(fee, { size: 3 }));
    }
  }
  return concat(parts);
}

/** Exact-output paths are encoded from output token to input token. */
export function encodeExactOutputPath(tokens: readonly Address[], fees: readonly number[]): Hex {
  return encodeSwapPath([...tokens].reverse(), [...fees].reverse());
}

export interface CreatePoolParams {
  tokenA: Address;
  tokenB: Address;
  /** Uniswap V3 fee tier in hundredths of a bip (100, 500, 3000, 10000). */
  fee: number;
  /** Initial sqrt price as Q64.96; 2^96 is 1:1 for 18-decimal tokens. */
  sqrtPriceX96: bigint;
}

export interface CreatedPool {
  pool: Address;
  token0: Address;
  token1: Address;
  fee: number;
  sqrtPriceX96: bigint;
}

export interface PoolSlot0 {
  sqrtPriceX96: bigint;
  tick: number;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  feeProtocol: number;
  unlocked: boolean;
}

export interface PoolProtocolFees {
  token0: bigint;
  token1: bigint;
}

export interface ProtocolCollected {
  pool: Address;
  recipient: Address;
  amount0: bigint;
  amount1: bigint;
}

/** Typed surface for the root `AgentswapPoolFactory`. */
export class AgentswapPoolFactoryActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, agentswapPoolFactoryAbi, functionName, args);
  }

  private write(functionName: string, args: readonly unknown[] = []): Promise<Hash> {
    return sendContract(this.context, { address: this.address, abi: agentswapPoolFactoryAbi, functionName, args });
  }

  governance(): Promise<Address> {
    return this.read<Address>("governance");
  }

  pendingGovernance(): Promise<Address> {
    return this.read<Address>("pendingGovernance");
  }

  canonicalFactory(): Promise<Address> {
    return this.read<Address>("canonicalFactory");
  }

  assetRegistry(): Promise<Address> {
    return this.read<Address>("assetRegistry");
  }

  quoteAssetRegistry(): Promise<Address> {
    return this.read<Address>("quoteAssetRegistry");
  }

  venueRegistry(): Promise<Address> {
    return this.read<Address>("venueRegistry");
  }

  policyRegistry(): Promise<Address> {
    return this.read<Address>("policyRegistry");
  }

  treasury(): Promise<Address> {
    return this.read<Address>("treasury");
  }

  isAllowedFee(fee: number): Promise<boolean> {
    return this.read<boolean>("isAllowedFee", [fee]);
  }

  /** Atomic create + initialize + fee setup + POOL registration. */
  createPool(params: CreatePoolParams): Promise<Hash> {
    return this.write("createPool", [params.tokenA, params.tokenB, params.fee, params.sqrtPriceX96]);
  }

  /** Wait for `createPool` and decode its `GatedPoolCreated` event. */
  async createdPool(hash: Hash): Promise<CreatedPool> {
    const factory = this.address.toLowerCase();
    const receipt = await this.context.publicClient.waitForTransactionReceipt({ hash });
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== factory) continue;
      try {
        const decoded = decodeEventLog({ abi: agentswapPoolFactoryAbi, data: log.data, topics: log.topics, strict: true });
        if (decoded.eventName === "GatedPoolCreated") {
          const args = decoded.args as unknown as {
            pool: Address;
            token0: Address;
            token1: Address;
            fee: number;
            sqrtPriceX96: bigint;
          };
          return { ...args };
        }
      } catch {
        // Not the expected factory event; ignore.
      }
    }
    throw new SdkError(`No GatedPoolCreated event found in transaction ${hash}.`);
  }

  setProtocolFee(pool: Address, feeProtocol0: number, feeProtocol1: number): Promise<Hash> {
    return this.write("setProtocolFee", [pool, feeProtocol0, feeProtocol1]);
  }

  collectProtocol(pool: Address, amount0Requested: bigint, amount1Requested: bigint): Promise<Hash> {
    return this.write("collectProtocol", [pool, amount0Requested, amount1Requested]);
  }

  setTreasury(newTreasury: Address): Promise<Hash> {
    return this.write("setTreasury", [newTreasury]);
  }

  enableFeeAmount(fee: number, tickSpacing: number): Promise<Hash> {
    return this.write("enableFeeAmount", [fee, tickSpacing]);
  }

  transferCanonicalFactoryOwnership(newOwner: Address): Promise<Hash> {
    return this.write("transferCanonicalFactoryOwnership", [newOwner]);
  }

  transferGovernance(newGovernance: Address): Promise<Hash> {
    return this.write("transferGovernance", [newGovernance]);
  }

  acceptGovernance(): Promise<Hash> {
    return this.write("acceptGovernance");
  }
}

/** Typed read surface for the canonical Uniswap V3 factory. */
export class UniswapV3FactoryActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, uniswapV3FactoryAbi, functionName, args);
  }

  owner(): Promise<Address> {
    return this.read<Address>("owner");
  }

  feeAmountTickSpacing(fee: number): Promise<number> {
    return this.read<number>("feeAmountTickSpacing", [fee]);
  }

  /** Returns the zero address when no pool exists for the pair/fee. */
  getPool(tokenA: Address, tokenB: Address, fee: number): Promise<Address> {
    const [token0, token1] = sortTokenPair(tokenA, tokenB);
    return this.read<Address>("getPool", [token0, token1, fee]);
  }
}

/** Read surface for one Uniswap V3 pool. Raw `swap`/`mint` are intentionally omitted. */
export class PoolActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, uniswapV3PoolAbi, functionName, args);
  }

  token0(): Promise<Address> {
    return this.read<Address>("token0");
  }

  token1(): Promise<Address> {
    return this.read<Address>("token1");
  }

  fee(): Promise<number> {
    return this.read<number>("fee");
  }

  tickSpacing(): Promise<number> {
    return this.read<number>("tickSpacing");
  }

  slot0(): Promise<PoolSlot0> {
    return this.read<PoolSlot0>("slot0");
  }

  liquidity(): Promise<bigint> {
    return this.read<bigint>("liquidity");
  }

  protocolFees(): Promise<PoolProtocolFees> {
    return this.read<PoolProtocolFees>("protocolFees");
  }

  observe(secondsAgos: readonly number[]): Promise<{
    tickCumulatives: readonly bigint[];
    secondsPerLiquidityCumulativeX128s: readonly bigint[];
  }> {
    return this.read("observe", [secondsAgos]);
  }

  positions(key: Hex): Promise<{
    liquidity: bigint;
    feeGrowthInside0LastX128: bigint;
    feeGrowthInside1LastX128: bigint;
    tokensOwed0: bigint;
    tokensOwed1: bigint;
  }> {
    return this.read("positions", [key]);
  }

  increaseObservationCardinalityNext(observationCardinalityNext: number): Promise<Hash> {
    return sendContract(this.context, {
      address: this.address,
      abi: uniswapV3PoolAbi,
      functionName: "increaseObservationCardinalityNext",
      args: [observationCardinalityNext],
    });
  }
}

export interface MintParams {
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: Address;
  deadline: bigint;
}

export interface IncreaseLiquidityParams {
  tokenId: bigint;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: bigint;
}

export interface DecreaseLiquidityParams {
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: bigint;
}

export interface CollectParams {
  tokenId: bigint;
  recipient: Address;
  amount0Max: bigint;
  amount1Max: bigint;
}

export interface MintResult {
  tokenId: bigint;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
}

export interface PositionInfo {
  nonce: bigint;
  operator: Address;
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

/** Typed surface for the gated `AgentswapPositionManager` (0.7.6 fork). */
export class PositionManagerActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, agentswapPositionManagerAbi, functionName, args);
  }

  private write(functionName: string, args: readonly unknown[] = [], value?: bigint): Promise<Hash> {
    return sendContract(this.context, {
      address: this.address,
      abi: agentswapPositionManagerAbi,
      functionName,
      args,
      ...(value === undefined ? {} : { value }),
    });
  }

  positions(tokenId: bigint): Promise<PositionInfo> {
    return this.read<PositionInfo>("positions", [tokenId]);
  }

  ownerOf(tokenId: bigint): Promise<Address> {
    return this.read<Address>("ownerOf", [tokenId]);
  }

  balanceOf(owner: Address): Promise<bigint> {
    return this.read<bigint>("balanceOf", [owner]);
  }

  tokenURI(tokenId: bigint): Promise<string> {
    return this.read<string>("tokenURI", [tokenId]);
  }

  /** Resolves the token's own policy; public tokens return the zero address. */
  policyOfToken(token: Address): Promise<Address> {
    return this.read<Address>("policyOfToken", [token]);
  }

  isAllowedRecipient(token: Address, to: Address): Promise<boolean> {
    return this.read<boolean>("isAllowedRecipient", [token, to]);
  }

  isAllowedTransfer(tokenId: bigint, from: Address, to: Address): Promise<boolean> {
    return this.read<boolean>("isAllowedTransfer", [tokenId, from, to]);
  }

  mint(params: MintParams): Promise<Hash> {
    return this.write("mint", [params]);
  }

  increaseLiquidity(params: IncreaseLiquidityParams): Promise<Hash> {
    return this.write("increaseLiquidity", [params]);
  }

  decreaseLiquidity(params: DecreaseLiquidityParams): Promise<Hash> {
    return this.write("decreaseLiquidity", [params]);
  }

  collect(params: CollectParams): Promise<Hash> {
    return this.write("collect", [params]);
  }

  burn(tokenId: bigint): Promise<Hash> {
    return this.write("burn", [tokenId]);
  }

  approve(to: Address, tokenId: bigint): Promise<Hash> {
    return this.write("approve", [to, tokenId]);
  }

  setApprovalForAll(operator: Address, approved: boolean): Promise<Hash> {
    return this.write("setApprovalForAll", [operator, approved]);
  }

  /** Wait for `mint` and decode its `IncreaseLiquidity` event. */
  async mintResult(hash: Hash): Promise<MintResult> {
    const manager = this.address.toLowerCase();
    const receipt = await this.context.publicClient.waitForTransactionReceipt({ hash });
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== manager) continue;
      try {
        const decoded = decodeEventLog({
          abi: agentswapPositionManagerAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        if (decoded.eventName === "IncreaseLiquidity") {
          const args = decoded.args as unknown as {
            tokenId: bigint;
            liquidity: bigint;
            amount0: bigint;
            amount1: bigint;
          };
          return { ...args };
        }
      } catch {
        // Ignore unrelated logs.
      }
    }
    throw new SdkError(`No IncreaseLiquidity event found in transaction ${hash}.`);
  }
}

export interface ExactInputSingleParams {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  recipient: Address;
  deadline: bigint;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint;
}

export interface ExactInputParams {
  /** Encoded path from `encodeSwapPath`. */
  path: Hex;
  recipient: Address;
  deadline: bigint;
  amountIn: bigint;
  amountOutMinimum: bigint;
}

export interface ExactOutputSingleParams {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  recipient: Address;
  deadline: bigint;
  amountOut: bigint;
  amountInMaximum: bigint;
  sqrtPriceLimitX96?: bigint;
}

export interface ExactOutputParams {
  /** Encoded path from `encodeExactOutputPath` (output token first). */
  path: Hex;
  recipient: Address;
  deadline: bigint;
  amountOut: bigint;
  amountInMaximum: bigint;
}

/** Typed surface for the 0.7.6 `AgentswapRouter`. */
export class AgentswapRouterActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private write(functionName: string, args: readonly unknown[] = []): Promise<Hash> {
    return sendContract(this.context, { address: this.address, abi: agentswapRouterAbi, functionName, args });
  }

  exactInputSingle(params: ExactInputSingleParams): Promise<Hash> {
    return this.write("exactInputSingle", [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: params.fee,
        recipient: params.recipient,
        deadline: params.deadline,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
      },
    ]);
  }

  exactInput(params: ExactInputParams): Promise<Hash> {
    return this.write("exactInput", [
      {
        path: params.path,
        recipient: params.recipient,
        deadline: params.deadline,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
      },
    ]);
  }

  exactOutputSingle(params: ExactOutputSingleParams): Promise<Hash> {
    return this.write("exactOutputSingle", [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: params.fee,
        recipient: params.recipient,
        deadline: params.deadline,
        amountOut: params.amountOut,
        amountInMaximum: params.amountInMaximum,
        sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
      },
    ]);
  }

  exactOutput(params: ExactOutputParams): Promise<Hash> {
    return this.write("exactOutput", [
      {
        path: params.path,
        recipient: params.recipient,
        deadline: params.deadline,
        amountOut: params.amountOut,
        amountInMaximum: params.amountInMaximum,
      },
    ]);
  }
}

export interface QuoteExactInputSingleParams {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  amountIn: bigint;
  sqrtPriceLimitX96?: bigint;
  /** Account whose policy is used for gated-output simulation (the caller). */
  caller?: Address;
}

export interface QuoteExactOutputSingleParams {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  amountOut: bigint;
  sqrtPriceLimitX96?: bigint;
  caller?: Address;
}

/**
 * Typed surface for the gated-aware `AgentswapQuoter`. Gated-output quotes are
 * caller-policy-scoped, so pass `caller` to simulate the executing agent.
 */
export class AgentswapQuoterActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  async quoteExactInputSingle(params: QuoteExactInputSingleParams): Promise<bigint> {
    return readContractValue<bigint>(
      this.context,
      this.address,
      agentswapQuoterAbi,
      "quoteExactInputSingle",
      [params.tokenIn, params.tokenOut, params.fee, params.amountIn, params.sqrtPriceLimitX96 ?? 0n],
      params.caller,
    );
  }

  async quoteExactInput(path: Hex, amountIn: bigint, caller?: Address): Promise<bigint> {
    return readContractValue<bigint>(
      this.context,
      this.address,
      agentswapQuoterAbi,
      "quoteExactInput",
      [path, amountIn],
      caller,
    );
  }

  async quoteExactOutputSingle(params: QuoteExactOutputSingleParams): Promise<bigint> {
    return readContractValue<bigint>(
      this.context,
      this.address,
      agentswapQuoterAbi,
      "quoteExactOutputSingle",
      [params.tokenIn, params.tokenOut, params.fee, params.amountOut, params.sqrtPriceLimitX96 ?? 0n],
      params.caller,
    );
  }

  async quoteExactOutput(path: Hex, amountOut: bigint, caller?: Address): Promise<bigint> {
    return readContractValue<bigint>(
      this.context,
      this.address,
      agentswapQuoterAbi,
      "quoteExactOutput",
      [path, amountOut],
      caller,
    );
  }
}

/** DEX entry points: pool creation/query, LP positions, swaps, quotes. */
export class DexClient {
  constructor(readonly context: SdkContext) {}

  poolFactory(address?: Address): AgentswapPoolFactoryActions {
    return new AgentswapPoolFactoryActions(this.context, this.context.addressOr("gatedPoolFactory", address));
  }

  canonicalFactory(address?: Address): UniswapV3FactoryActions {
    return new UniswapV3FactoryActions(this.context, this.context.addressOr("canonicalFactory", address));
  }

  positionManager(address?: Address): PositionManagerActions {
    return new PositionManagerActions(this.context, this.context.addressOr("positionManager", address));
  }

  router(address?: Address): AgentswapRouterActions {
    return new AgentswapRouterActions(this.context, this.context.addressOr("swapRouter", address));
  }

  quoter(address?: Address): AgentswapQuoterActions {
    return new AgentswapQuoterActions(this.context, this.context.addressOr("quoter", address));
  }

  pool(address: Address): PoolActions {
    return new PoolActions(this.context, address);
  }

  /**
   * Look up a canonical pool. Uses the configured canonical factory, falling
   * back to the gated factory's immutable `canonicalFactory()`.
   */
  async getPool(tokenA: Address, tokenB: Address, fee: number, canonicalFactory?: Address): Promise<Address> {
    let factory = canonicalFactory ?? this.context.optionalAddress("canonicalFactory");
    if (factory === undefined) factory = await this.poolFactory().canonicalFactory();
    return this.canonicalFactory(factory).getPool(tokenA, tokenB, fee);
  }

  createPool(params: CreatePoolParams): Promise<Hash> {
    return this.poolFactory().createPool(params);
  }

  createdPool(hash: Hash): Promise<CreatedPool> {
    return this.poolFactory().createdPool(hash);
  }
}
