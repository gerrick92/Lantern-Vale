import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

const first = "0x0000000000000000000000000000000000000001" as Address;
const second = "0x0000000000000000000000000000000000000002" as Address;
const token = "0x0000000000000000000000000000000000000003" as Address;
const faucet = "0x0000000000000000000000000000000000000004" as Address;
const hash = `0x${"ab".repeat(32)}`;
const unit = 10n ** 18n;
let account: Address | undefined = first;
let block = 100n;
let claimed = false;
let reject = false;
let finish: ((success: boolean) => void) | undefined;
const listeners = new Set<() => void>();
declare global {
  interface Window {
    walletFixture: {
      switchWallet(value: "first" | "second" | "none"): void;
      confirm(success: boolean): void;
      reject(): void;
      confirmations: number;
      pending: boolean;
    };
  }
}
window.walletFixture = {
  switchWallet(value) {
    account =
      value === "first" ? first : value === "second" ? second : undefined;
    listeners.forEach((notify) => notify());
  },
  confirm(success) {
    finish?.(success);
  },
  reject() {
    reject = true;
  },
  confirmations: 0,
  pending: false,
};
export function useConnection() {
  const address = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => account,
  );
  return { address, chainId: 11155111 };
}
type Read = {
  functionName: string;
  address: Address;
  args?: readonly unknown[];
  blockNumber?: bigint;
};
const rpc = {
  async getChainId() {
    return 11155111;
  },
  async getBalance() {
    return unit;
  },
  async getBlockNumber() {
    return block;
  },
  async readContract(input: Read) {
    const name = input.functionName;
    if (name === "name") return "Lantern Vale Glow";
    if (name === "symbol") return "GLOW";
    if (name === "decimals") return 18;
    if (name === "cap") return 1_000_000n * unit;
    if (name === "totalSupply") return 5000n * unit;
    if (name === "owner") return first;
    if (name === "token") return token;
    if (name === "CLAIM_AMOUNT") return 5n * unit;
    if (name === "COOLDOWN") return 86400n;
    if (name === "nextClaimAt")
      return input.args?.[0] === first && claimed
        ? BigInt(Math.floor(Date.now() / 1000) + 86400)
        : 0n;
    if (name === "balanceOf") {
      if (input.args?.[0] === faucet) return (claimed ? 4990n : 4995n) * unit;
      if (input.args?.[0] === first) return (claimed ? 10n : 5n) * unit;
      return 0n;
    }
    throw new Error(`Unexpected fixture read: ${name}`);
  },
  async simulateContract(input: unknown) {
    return { request: input };
  },
  async waitForTransactionReceipt(input: { confirmations: number }) {
    window.walletFixture.confirmations = input.confirmations;
    window.walletFixture.pending = true;
    const success = await new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    if (success) {
      claimed = true;
      block++;
    }
    window.walletFixture.pending = false;
    return {
      status: success ? "success" : "reverted",
      transactionHash: hash,
      blockNumber: block,
    };
  },
};
const wallet = {
  async getAddresses() {
    return [account];
  },
  async getChainId() {
    return 11155111;
  },
  async writeContract() {
    if (reject) throw new Error("User rejected the request.");
    return hash;
  },
  async watchAsset() {
    return true;
  },
};
export function usePublicClient() {
  return rpc;
}
export function useWalletClient() {
  return { data: wallet };
}
export function useReadContract(
  input: Read & { query?: { enabled?: boolean } },
) {
  return useQuery({
    queryKey: ["readContract", input.address, input.functionName, input.args],
    queryFn: () => rpc.readContract(input),
    enabled: input.query?.enabled,
  });
}
export function useReadContracts(input: {
  contracts: Read[];
  query?: { enabled?: boolean };
}) {
  return useQuery({
    queryKey: ["readContracts", input.contracts],
    queryFn: () =>
      Promise.all(
        input.contracts.map(async (read) => ({
          result: await rpc.readContract(read),
        })),
      ),
    enabled: input.query?.enabled,
  });
}
