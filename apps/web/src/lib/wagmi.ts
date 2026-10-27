"use client";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { sepolia } from "viem/chains";
import { RPC_URL } from "./chain";
export const wagmiConfig = createConfig({
  chains: [sepolia],
  ssr: true,
  connectors: [injected({ target: "metaMask", shimDisconnect: true })],
  transports: {
    [sepolia.id]: http(RPC_URL, { timeout: 12_000, retryCount: 2 }),
  },
});
