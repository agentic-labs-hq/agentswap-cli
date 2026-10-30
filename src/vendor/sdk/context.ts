import {
  createPublicClient,
  http,
  type Abi,
  type Account,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";

import {
  resolveSdkConfig,
  type AddressKey,
  type ResolvedSdkConfig,
  type SdkConfig,
} from "./config.js";
import { MissingAddressError, SdkError } from "./errors.js";

/** Shared read-only client, chain metadata, and address book. */
export class SdkContext {
  readonly config: ResolvedSdkConfig;
  readonly publicClient: PublicClient;

  constructor(config: SdkConfig) {
    this.config = resolveSdkConfig(config);
    const transport = this.config.transport ?? http(this.config.rpcUrl);
    this.publicClient = createPublicClient({
      chain: this.config.chain,
      transport,
      ...(this.config.pollingInterval === undefined ? {} : { pollingInterval: this.config.pollingInterval }),
    });
  }

  get chain() {
    return this.config.chain;
  }

  get chainId() {
    return this.config.chainId;
  }

  get addresses() {
    return this.config.addresses;
  }

  /** Return a configured address or throw a descriptive `MissingAddressError`. */
  address(key: AddressKey): Address {
    const value = this.config.addresses[key];
    if (value === undefined) throw new MissingAddressError(key);
    return value;
  }

  /** Return a configured address, or an explicitly supplied override. */
  addressOr(key: AddressKey, override: Address | undefined): Address {
    if (override !== undefined) return override;
    return this.address(key);
  }

  /** Return a configured address without throwing. */
  optionalAddress(key: AddressKey): Address | undefined {
    return this.config.addresses[key];
  }
}

/**
 * viem's broad `Abi` return type decodes multi-output functions as an array.
 * The typed clients expose named fields, so normalize those results while
 * leaving single-output values (including arrays) untouched.
 */
function shapeReadResult(abi: Abi, functionName: string, result: unknown): unknown {
  const item = abi.find((entry) => entry.type === "function" && entry.name === functionName);
  if (item === undefined || item.type !== "function") return result;
  const outputs = item.outputs ?? [];
  if (outputs.length <= 1 || !Array.isArray(result)) return result;
  if (outputs.every((output) => output.name === undefined || output.name === "")) return result;
  const shaped: Record<string, unknown> = {};
  outputs.forEach((output, index) => {
    shaped[output.name ?? String(index)] = result[index];
  });
  return shaped;
}

export interface ContractWriteParams {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

/**
 * This standalone package is a read-only preview bundle. It deliberately has no
 * local wallet. Write helpers retained in the vendored SDK surface fail closed;
 * execution must go through the Binance Agentic Wallet (`baw`).
 */
export async function sendContract(_context: SdkContext, _params: ContractWriteParams): Promise<Hash> {
  throw new SdkError(
    "This package is read-only: use the Binance Agentic Wallet preview/execute flow instead of a local signer.",
  );
}

/** Typed wrapper around viem `readContract` that keeps call sites compact. */
export async function readContractValue<T>(
  context: SdkContext,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  account?: Account | Address,
): Promise<T> {
  const result = await context.publicClient.readContract({
    address,
    abi,
    functionName,
    args,
    ...(account === undefined ? {} : { account }),
  });
  return shapeReadResult(abi, functionName, result) as T;
}
