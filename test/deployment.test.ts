import { ADDRESS_KEYS } from "../src/vendor/sdk/index.js";
import { describe, expect, it } from "vitest";
import { isAddress, zeroAddress } from "viem";

import { DEFAULT_DEPLOYMENT_PATH, deploymentAddress, loadDeployment } from "../src/deployment.js";

const EXPECTED: Record<string, string> = {
  tokenFactory: "0x0c05551Ba2d262e99616634111ef693716A986ce",
  assetRegistry: "0xe2e2280B7662918564AC900801Ba80292602B1a1",
  quoteAssetRegistry: "0x5F3D85574A4eaee8438a24Df147a6878937784Ce",
  venueRegistry: "0xD07B95112865f84a5563CDAB8CC69C0058784927",
  policyRegistry: "0x7fb3A4a4df80C84a92F35B2fF356C6D201EDDc2A",
  facilityFactory: "0xf9E9A9F98e012C01994B91D83b57278ED08d4534",
  protocolTreasury: "0xd06b024f0A7F9509D9cd85e5BC44abfb82E5b4A8",
  gatedPoolFactory: "0xEc281F077C643CaDd4Ca90724C287552ca3e84e7",
  canonicalFactory: "0x83BC4672076BCb1167219fefC26089e45e75C813",
  positionManager: "0x718204f0fb6A7ACD41D314abfD6331b43f502eC0",
  swapRouter: "0x460A4F74580369817c699A6F4fE3d2d2Ce1fef50",
  quoter: "0xDB1874Adb5432ed3EC2153192c4243c64111AA5e",
};

describe("deployments/56.json", () => {
  const deployment = loadDeployment();

  it("loads the branded BSC mainnet address book", () => {
    expect(DEFAULT_DEPLOYMENT_PATH.endsWith("deployments/56.json")).toBe(true);
    expect(deployment.chainId).toBe(56);
    expect(deployment.network).toBe("bsc-mainnet");
    expect(deployment.startBlock).toBe(130298566);
    expect(deployment.governance).toBe("0x88Db9a7FCf2e8abc0dDa5Ed88248e1e73E8aaa35");
    expect(deployment).not.toHaveProperty("deployer");
  });

  it("contains every SDK address key with the expected address", () => {
    for (const key of ADDRESS_KEYS) {
      expect(deployment.addresses[key], key).toBe(EXPECTED[key]);
      expect(isAddress(deployment.addresses[key]!)).toBe(true);
      expect(deployment.addresses[key]).not.toBe(zeroAddress);
    }
  });

  it("contains the branded extras and quote assets", () => {
    expect(deployment.policy).toBe("0xdb7FA5F2DDEaCF0Dbd7cd8ACa12A43A1050D4Ff7");
    expect(deployment.identityAdapter).toBe("0xbf820DaA0AD3a13a10C7D1d493F985DD1109F894");
    expect(deployment.agentIdRegistry).toBe("0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F");
    expect(deployment.identityRegistry).toBe("0x5b37862DB1d456Ba2BA7E548Ec9A9ae5FAB49A87");
    expect(deployment.nftDescriptor).toBe("0xb078D5B6CD021d7921D48D842d9a2A0abF9F1E79");
    expect(deployment.positionDescriptor).toBe("0x7265b042a8Fe02309EA2c321C5De0d16bE863ad4");
    expect(deployment.wbnb).toBe("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
    expect(deployment.usdt).toBe("0x55d398326f99059fF775485246999027B3197955");
    expect(deployment.quoteTokens).toEqual([deployment.wbnb, deployment.usdt]);
  });

  it("exposes addresses by SDK key", () => {
    expect(deploymentAddress(deployment, "tokenFactory")).toBe(EXPECTED.tokenFactory);
    expect(deploymentAddress(deployment, "positionManager")).toBe(EXPECTED.positionManager);
  });

  it("rejects a missing deployment file", () => {
    expect(() => loadDeployment("/nonexistent/deployments/56.json")).toThrowError(/Cannot read deployment address book/);
  });
});
