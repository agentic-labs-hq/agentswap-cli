import type { Address } from "viem";

import { agenticTokenAbi, agenticTokenFactoryAbi } from "./abi/index.js";
import { readContractValue, type SdkContext } from "./context.js";

export interface TokenInfo {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  factory: Address;
  policy: Address;
  creator: Address;
  metadataURI: string;
  assetType: number;
}

export interface TokenFactoryInfo {
  address: Address;
  policyRegistry: Address;
  assetRegistry: Address;
  facilityRegistry: Address;
  maxRecipients: bigint;
}

/** Typed read-only surface for one deployed `AgenticToken`. */
export class TokenActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, agenticTokenAbi, functionName, args);
  }

  name(): Promise<string> {
    return this.read<string>("name");
  }

  symbol(): Promise<string> {
    return this.read<string>("symbol");
  }

  decimals(): Promise<number> {
    return this.read<number>("decimals");
  }

  totalSupply(): Promise<bigint> {
    return this.read<bigint>("totalSupply");
  }

  balanceOf(account: Address): Promise<bigint> {
    return this.read<bigint>("balanceOf", [account]);
  }

  allowance(owner: Address, spender: Address): Promise<bigint> {
    return this.read<bigint>("allowance", [owner, spender]);
  }

  factory(): Promise<Address> {
    return this.read<Address>("factory");
  }

  policy(): Promise<Address> {
    return this.read<Address>("policy");
  }

  creator(): Promise<Address> {
    return this.read<Address>("creator");
  }

  metadataURI(): Promise<string> {
    return this.read<string>("metadataURI");
  }

  assetType(): Promise<number> {
    return this.read<number>("assetType");
  }

  async info(): Promise<TokenInfo> {
    const [name, symbol, decimals, totalSupply, factory, policy, creator, metadataURI, assetType] = await Promise.all([
      this.name(),
      this.symbol(),
      this.decimals(),
      this.totalSupply(),
      this.factory(),
      this.policy(),
      this.creator(),
      this.metadataURI(),
      this.assetType(),
    ]);
    return {
      address: this.address,
      name,
      symbol,
      decimals,
      totalSupply,
      factory,
      policy,
      creator,
      metadataURI,
      assetType,
    };
  }
}

/** Factory-level typed client: token and factory configuration reads. */
export class TokenClient {
  constructor(readonly context: SdkContext) {}

  /** Token actions for any deployed token; the factory address is not required. */
  at(address: Address): TokenActions {
    return new TokenActions(this.context, address);
  }

  private factoryAddress(): Address {
    return this.context.address("tokenFactory");
  }

  async factoryInfo(): Promise<TokenFactoryInfo> {
    const address = this.factoryAddress();
    const [policyRegistry, assetRegistry, facilityRegistry, maxRecipients] = await Promise.all([
      readContractValue<Address>(this.context, address, agenticTokenFactoryAbi, "policyRegistry"),
      readContractValue<Address>(this.context, address, agenticTokenFactoryAbi, "assetRegistry"),
      readContractValue<Address>(this.context, address, agenticTokenFactoryAbi, "facilityRegistry"),
      readContractValue<bigint>(this.context, address, agenticTokenFactoryAbi, "maxRecipients"),
    ]);
    return { address, policyRegistry, assetRegistry, facilityRegistry, maxRecipients };
  }

  policyRegistry(): Promise<Address> {
    return readContractValue<Address>(
      this.context,
      this.factoryAddress(),
      agenticTokenFactoryAbi,
      "policyRegistry",
    );
  }

  assetRegistry(): Promise<Address> {
    return readContractValue<Address>(
      this.context,
      this.factoryAddress(),
      agenticTokenFactoryAbi,
      "assetRegistry",
    );
  }

  facilityRegistry(): Promise<Address> {
    return readContractValue<Address>(
      this.context,
      this.factoryAddress(),
      agenticTokenFactoryAbi,
      "facilityRegistry",
    );
  }

  maxRecipients(): Promise<bigint> {
    return readContractValue<bigint>(
      this.context,
      this.factoryAddress(),
      agenticTokenFactoryAbi,
      "maxRecipients",
    );
  }
}
