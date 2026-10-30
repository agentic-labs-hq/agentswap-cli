import { parseAbi } from "viem";

/**
 * Minimal ABI fragments for calls the SDK does not expose as typed helpers
 * (simulation and NPM enumeration). The SDK's generated ABIs are authoritative
 * for the typed read/write clients; these fragments keep this package compiling
 * against the built SDK surface without modifying protocol source.
 */
export const tokenFactoryAbi = parseAbi([
  "function createToken(string name, string symbol, address policy, address[] initialRecipients, uint256[] initialAmounts, string metadataURI) returns (address token)",
  "event TokenCreated(address indexed token, address indexed creator, address indexed policy)",
]);

export const poolFactoryAbi = parseAbi([
  "function createPool(address tokenA, address tokenB, uint24 fee, uint160 sqrtPriceX96) returns (address pool)",
  "event GatedPoolCreated(address indexed pool, address token0, address token1, uint24 fee, uint160 sqrtPriceX96)",
]);

export const positionManagerAbi = parseAbi([
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256 tokenId)",
  "function balanceOf(address owner) view returns (uint256 balance)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
  "function burn(uint256 tokenId) payable",
]);

export const swapRouterAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

export const poolAbi = parseAbi([
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);
