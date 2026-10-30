import type { Abi } from "viem";

import agenticTokenJson from "./AgenticToken.json" with { type: "json" };
import agenticTokenFactoryJson from "./AgenticTokenFactory.json" with { type: "json" };
import agenticAssetRegistryJson from "./AgenticAssetRegistry.json" with { type: "json" };
import agentswapPoolFactoryJson from "./AgentswapPoolFactory.json" with { type: "json" };
import agentswapPositionManagerJson from "./AgentswapPositionManager.json" with { type: "json" };
import agenticPolicyRegistryJson from "./AgenticPolicyRegistry.json" with { type: "json" };
import agenticQuoteAssetRegistryJson from "./AgenticQuoteAssetRegistry.json" with { type: "json" };
import agentswapQuoterJson from "./AgentswapQuoter.json" with { type: "json" };
import agentswapRouterJson from "./AgentswapRouter.json" with { type: "json" };
import uniswapV3FactoryJson from "./UniswapV3Factory.json" with { type: "json" };
import uniswapV3PoolJson from "./UniswapV3Pool.json" with { type: "json" };
import agenticVenueRegistryJson from "./AgenticVenueRegistry.json" with { type: "json" };
import transferPolicyJson from "./ITransferPolicy.json" with { type: "json" };

/**
 * JSON imports are widened by `resolveJsonModule` (the `type` fields become
 * `string` rather than the `AbiItem` literal union). The files are generated
 * from the public protocol build; the assertion is the narrowest bridge from
 * JSON to viem's `Abi` type.
 */
function asAbi(value: unknown): Abi {
  return value as Abi;
}

export const agenticTokenAbi = asAbi(agenticTokenJson);
export const agenticTokenFactoryAbi = asAbi(agenticTokenFactoryJson);
export const agenticAssetRegistryAbi = asAbi(agenticAssetRegistryJson);
export const agentswapPoolFactoryAbi = asAbi(agentswapPoolFactoryJson);
export const agentswapPositionManagerAbi = asAbi(agentswapPositionManagerJson);
export const agenticPolicyRegistryAbi = asAbi(agenticPolicyRegistryJson);
export const agenticQuoteAssetRegistryAbi = asAbi(agenticQuoteAssetRegistryJson);
export const agentswapQuoterAbi = asAbi(agentswapQuoterJson);
export const agentswapRouterAbi = asAbi(agentswapRouterJson);
export const uniswapV3FactoryAbi = asAbi(uniswapV3FactoryJson);
export const uniswapV3PoolAbi = asAbi(uniswapV3PoolJson);
export const agenticVenueRegistryAbi = asAbi(agenticVenueRegistryJson);
export const transferPolicyAbi = asAbi(transferPolicyJson);
