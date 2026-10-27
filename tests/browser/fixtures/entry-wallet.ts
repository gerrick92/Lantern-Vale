import { useSyncExternalStore } from "react";
import { encodeFunctionData, type Address, type Abi, type Hash } from "viem";

export const entryWallet =
  "0x0000000000000000000000000000000000000001" as Address;
let address: Address | undefined = entryWallet;
let chainId = 11155111;
let clientReady = true;
let allowance = 0n;
let confirmNext: (() => void) | undefined;
const blockHash = `0x${"cd".repeat(32)}` as Hash;
const submitted = new Map<Hash, { to: Address; input: Hash }>();
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((listener) => listener());
};
function useFixture() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => version,
  );
}
declare global {
  interface Window {
    entryFixture: {
      signatures: number;
      transactions: number;
      rejectSignature: boolean;
      holdTransactions: boolean;
      walletRequests: string[];
      confirmNext(): void;
      route?: string;
      switchWallet(value?: Address): void;
      switchChain(value: number): void;
      ready(value: boolean): void;
    };
  }
}
window.entryFixture = {
  signatures: 0,
  transactions: 0,
  rejectSignature: false,
  holdTransactions: false,
  walletRequests: [],
  confirmNext() {
    const confirm = confirmNext;
    confirmNext = undefined;
    confirm?.();
  },
  switchWallet(value) {
    address = value;
    notify();
  },
  switchChain(value) {
    chainId = value;
    notify();
  },
  ready(value) {
    clientReady = value;
    notify();
  },
};
export function useConnection() {
  useFixture();
  return {
    address,
    chainId,
    isConnected: !!address,
    status: address ? "connected" : "disconnected",
  };
}
const connectors = [
  { id: "io.metamask", name: "MetaMask", getProvider: async () => ({}) },
];
export function useConnectors() {
  return connectors;
}
export function useConnect() {
  return {
    isPending: false,
    error: null,
    mutate() {
      address = entryWallet;
      notify();
    },
  };
}
export function useDisconnect() {
  return {
    mutate() {
      address = undefined;
      notify();
    },
  };
}
export function useSwitchChain() {
  return {
    isPending: false,
    error: null,
    mutate() {
      chainId = 11155111;
      notify();
    },
  };
}
export function useBalance() {
  return { data: { value: 10n ** 18n }, refetch: async () => undefined };
}
export function useSignMessage() {
  return {
    mutateAsync: async () => {
      window.entryFixture.signatures++;
      if (window.entryFixture.rejectSignature)
        throw new Error("Signature declined. You can try again.");
      return `0x${"11".repeat(65)}`;
    },
  };
}
const rpc = {
  getChainId: async () => chainId,
  getBalance: async () => 10n ** 18n,
  getBlock: async () => ({
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    hash: blockHash,
  }),
  getBlockNumber: async () => 101n,
  getTransaction: async ({ hash }: { hash: Hash }) => ({
    ...submitted.get(hash),
    from: address,
    chainId,
    value: 0n,
    blockHash,
  }),
  waitForTransactionReceipt: async ({ hash }: { hash: Hash }) => ({
    transactionHash: hash,
    status: "success",
    blockHash,
    blockNumber: 100n,
  }),
  readContract: async ({ functionName }: { functionName: string }) => {
    if (functionName === "token")
      return "0x0000000000000000000000000000000000000003";
    if (functionName === "paused") return false;
    if (functionName === "balanceOf") return 15n * 10n ** 18n;
    if (functionName === "allowance") return allowance;
    if (functionName === "paymentRound") return 0n;
    throw new Error(`Unexpected fixture read: ${functionName}`);
  },
  simulateContract: async (request: unknown) => ({ request }),
};
const wallet = {
  getAddresses: async () => [address],
  getChainId: async () => chainId,
  writeContract: async (call: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
  }) => {
    window.entryFixture.transactions++;
    window.entryFixture.walletRequests.push(call.functionName);
    if (!window.entryFixture.holdTransactions)
      throw Object.assign(
        new Error("Transaction declined in the test wallet."),
        { code: 4001 },
      );
    // Synthetic receipts are only for the isolated browser regression, never live evidence.
    return new Promise<Hash>((resolve) => {
      confirmNext = () => {
        const hash =
          `0x${(call.functionName === "approve" ? "ac" : "ab").repeat(32)}` as Hash;
        if (call.functionName === "approve") allowance = call.args[1] as bigint;
        else allowance = 0n;
        submitted.set(hash, {
          to: call.address,
          input: encodeFunctionData(call),
        });
        resolve(hash);
      };
    });
  },
};
export function usePublicClient() {
  return rpc;
}
export function useWalletClient() {
  useFixture();
  return { data: clientReady ? wallet : undefined };
}
export function useRouter() {
  return {
    push(path: string) {
      window.entryFixture.route = path;
    },
  };
}
