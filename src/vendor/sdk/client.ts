import type { PublicClient } from "viem";

import type { AddressKey, ContractAddresses, ResolvedSdkConfig, SdkConfig } from "./config.js";
import { SdkContext } from "./context.js";
import { DexClient } from "./dex.js";
import { RegistryClient } from "./registry.js";
import { TokenClient } from "./token.js";

/**
 * Read-only aggregate SDK used by the standalone CLI. There is intentionally no
 * account, wallet client, or local signing surface.
 */
export class Sdk {
  readonly context: SdkContext;
  readonly tokens: TokenClient;
  readonly registries: RegistryClient;
  readonly dex: DexClient;

  constructor(config: SdkConfig) {
    this.context = new SdkContext(config);
    this.tokens = new TokenClient(this.context);
    this.registries = new RegistryClient(this.context);
    this.dex = new DexClient(this.context);
  }

  get config(): ResolvedSdkConfig {
    return this.context.config;
  }

  get publicClient(): PublicClient {
    return this.context.publicClient;
  }

  get chain() {
    return this.context.chain;
  }

  get chainId(): number {
    return this.context.chainId;
  }

  get addresses(): Readonly<ContractAddresses> {
    return this.context.addresses;
  }

  address(key: AddressKey) {
    return this.context.address(key);
  }
}

/** Create an SDK instance. Construction performs no network calls. */
export function createSdk(config: SdkConfig): Sdk {
  return new Sdk(config);
}
