import type { Address, Hex } from "viem";

import {
  agenticAssetRegistryAbi,
  agenticPolicyRegistryAbi,
  agenticQuoteAssetRegistryAbi,
  transferPolicyAbi,
  agenticVenueRegistryAbi,
} from "./abi/index.js";
import { readContractValue, type SdkContext } from "./context.js";

/** `FacilityCategory` enum values. */
export const FACILITY_CATEGORY = {
  NONE: 0,
  POOL: 1,
  LP_MANAGER: 2,
  FEE_RECIPIENT: 3,
  CUSTODY: 4,
  PURPOSE: 5,
} as const;

export type FacilityCategory = (typeof FACILITY_CATEGORY)[keyof typeof FACILITY_CATEGORY];

/** Read-only typed surface for the gated `AgenticAssetRegistry`. */
export class AgenticAssetRegistryActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, agenticAssetRegistryAbi, functionName, args);
  }

  governance(): Promise<Address> {
    return this.read<Address>("governance");
  }

  pendingGovernance(): Promise<Address> {
    return this.read<Address>("pendingGovernance");
  }

  policyRegistry(): Promise<Address> {
    return this.read<Address>("policyRegistry");
  }

  venueRegistry(): Promise<Address> {
    return this.read<Address>("venueRegistry");
  }

  maxPoolsPerAsset(): Promise<bigint> {
    return this.read<bigint>("maxPoolsPerAsset");
  }

  isRegistered(asset: Address): Promise<boolean> {
    return this.read<boolean>("isRegistered", [asset]);
  }

  policyOf(asset: Address): Promise<Address> {
    return this.read<Address>("policyOf", [asset]);
  }

  creatorOf(asset: Address): Promise<Address> {
    return this.read<Address>("creatorOf", [asset]);
  }

  poolsOf(asset: Address): Promise<readonly Address[]> {
    return this.read<readonly Address[]>("poolsOf", [asset]);
  }

  isRegistrar(account: Address): Promise<boolean> {
    return this.read<boolean>("isRegistrar", [account]);
  }
}

/** Read-only typed surface for the governance-curated `AgenticQuoteAssetRegistry`. */
export class AgenticQuoteAssetRegistryActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, agenticQuoteAssetRegistryAbi, functionName, args);
  }

  governance(): Promise<Address> {
    return this.read<Address>("governance");
  }

  pendingGovernance(): Promise<Address> {
    return this.read<Address>("pendingGovernance");
  }

  assetRegistry(): Promise<Address> {
    return this.read<Address>("assetRegistry");
  }

  maxQuoteAssets(): Promise<bigint> {
    return this.read<bigint>("maxQuoteAssets");
  }

  isQuoteAsset(token: Address): Promise<boolean> {
    return this.read<boolean>("isQuoteAsset", [token]);
  }

  quoteAssets(): Promise<readonly Address[]> {
    return this.read<readonly Address[]>("quoteAssets");
  }
}

/** Read-only typed surface for the `AgenticVenueRegistry` (facility registry). */
export class AgenticVenueRegistryActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, agenticVenueRegistryAbi, functionName, args);
  }

  governance(): Promise<Address> {
    return this.read<Address>("governance");
  }

  pendingGovernance(): Promise<Address> {
    return this.read<Address>("pendingGovernance");
  }

  isFacility(account: Address): Promise<boolean> {
    return this.read<boolean>("isFacility", [account]);
  }

  facilityType(account: Address): Promise<Hex> {
    return this.read<Hex>("facilityType", [account]);
  }

  facilityCategory(account: Address): Promise<number> {
    return this.read<number>("facilityCategory", [account]);
  }

  isFacilityOfCategory(account: Address, category: FacilityCategory): Promise<boolean> {
    return this.read<boolean>("isFacilityOfCategory", [account, category]);
  }

  isFacilityOfType(account: Address, kind: Hex): Promise<boolean> {
    return this.read<boolean>("isFacilityOfType", [account, kind]);
  }

  isRevokedFacility(account: Address): Promise<boolean> {
    return this.read<boolean>("isRevokedFacility", [account]);
  }

  replacementOf(account: Address): Promise<Address> {
    return this.read<Address>("replacementOf", [account]);
  }

  factoryOf(account: Address): Promise<Address> {
    return this.read<Address>("factoryOf", [account]);
  }

  categoryOfType(kind: Hex): Promise<number> {
    return this.read<number>("categoryOfType", [kind]);
  }

  isRegistrarFor(account: Address, category: FacilityCategory): Promise<boolean> {
    return this.read<boolean>("isRegistrarFor", [account, category]);
  }
}

/** Read-only typed surface for the versioned `AgenticPolicyRegistry`. */
export class AgenticPolicyRegistryActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, agenticPolicyRegistryAbi, functionName, args);
  }

  governance(): Promise<Address> {
    return this.read<Address>("governance");
  }

  pendingGovernance(): Promise<Address> {
    return this.read<Address>("pendingGovernance");
  }

  currentPolicy(): Promise<Address> {
    return this.read<Address>("currentPolicy");
  }

  policies(): Promise<readonly Address[]> {
    return this.read<readonly Address[]>("policies");
  }

  maxPolicies(): Promise<bigint> {
    return this.read<bigint>("maxPolicies");
  }

  policyVersion(policy: Address): Promise<bigint> {
    return this.read<bigint>("policyVersion", [policy]);
  }

  isPolicyAllowed(policy: Address): Promise<boolean> {
    return this.read<boolean>("isPolicyAllowed", [policy]);
  }
}

export interface TransferDecision {
  allowed: boolean;
  reason: Hex;
}

/** Read-only typed surface for an `ITransferPolicy` version. */
export class TransferPolicyActions {
  constructor(
    readonly context: SdkContext,
    readonly address: Address,
  ) {}

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return readContractValue<T>(this.context, this.address, transferPolicyAbi, functionName, args);
  }

  /** Static policy decision; `context` is the ABI-encoded TransferKind bytes. */
  canTransfer(asset: Address, from: Address, to: Address, operator: Address, context: Hex): Promise<TransferDecision> {
    return this.read<TransferDecision>("canTransfer", [asset, from, to, operator, context]);
  }

  isMember(wallet: Address): Promise<boolean> {
    return this.read<boolean>("isMember", [wallet]);
  }

  isFacility(account: Address): Promise<boolean> {
    return this.read<boolean>("isFacility", [account]);
  }

  isEligible(account: Address): Promise<boolean> {
    return this.read<boolean>("isEligible", [account]);
  }

  categoryOf(account: Address): Promise<number> {
    return this.read<number>("categoryOf", [account]);
  }

  isRevokedFacility(account: Address): Promise<boolean> {
    return this.read<boolean>("isRevokedFacility", [account]);
  }

  replacementOf(account: Address): Promise<Address> {
    return this.read<Address>("replacementOf", [account]);
  }

  identityRegistry(): Promise<Address> {
    return this.read<Address>("identityRegistry");
  }

  facilityRegistry(): Promise<Address> {
    return this.read<Address>("facilityRegistry");
  }
}

/** Registry entry points. Each accepts an address override for multi-deployment use. */
export class RegistryClient {
  constructor(readonly context: SdkContext) {}

  assetRegistry(address?: Address): AgenticAssetRegistryActions {
    return new AgenticAssetRegistryActions(this.context, this.context.addressOr("assetRegistry", address));
  }

  quoteAssetRegistry(address?: Address): AgenticQuoteAssetRegistryActions {
    return new AgenticQuoteAssetRegistryActions(this.context, this.context.addressOr("quoteAssetRegistry", address));
  }

  venueRegistry(address?: Address): AgenticVenueRegistryActions {
    return new AgenticVenueRegistryActions(this.context, this.context.addressOr("venueRegistry", address));
  }

  policyRegistry(address?: Address): AgenticPolicyRegistryActions {
    return new AgenticPolicyRegistryActions(this.context, this.context.addressOr("policyRegistry", address));
  }

  /** Transfer policy versions are per-token; pass the token's policy address. */
  transferPolicy(address: Address): TransferPolicyActions {
    return new TransferPolicyActions(this.context, address);
  }
}
