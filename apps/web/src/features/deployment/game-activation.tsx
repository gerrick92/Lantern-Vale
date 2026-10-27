"use client";
import { useState } from "react";
import { useConnection, usePublicClient, useWalletClient } from "wagmi";
import { isAddressEqual, parseEther, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { api } from "@/lib/api";

export function GameActivation() {
  const connection = useConnection(),
    rpc = usePublicClient({ chainId: 11155111 }),
    wallet = useWalletClient();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function activate() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const plan = await api<{
        chainId: number;
        owner: Address;
        to: Address;
        data: Hex;
        value: string;
        paused: boolean;
      }>("/dev/deploy/game/activation", {});
      if (!plan.paused) {
        setMessage(
          "The game is active on Sepolia. Owner acceptance is available from Play.",
        );
        return;
      }
      if (
        !rpc ||
        !wallet.data ||
        !connection.address ||
        connection.chainId !== 11155111 ||
        (await wallet.data.getChainId()) !== 11155111 ||
        !isAddressEqual(connection.address, plan.owner)
      )
        throw new Error("Connect the reviewed owner wallet on Sepolia.");
      const tx = {
        account: plan.owner,
        to: plan.to,
        data: plan.data,
        value: 0n,
      };
      const gas = await rpc.estimateGas(tx),
        fees = await rpc.estimateFeesPerGas();
      if (((gas * 12n) / 10n) * fees.maxFeePerGas > parseEther("0.001"))
        throw new Error(
          "Network fees exceed the acceptance-test limit. Retry later.",
        );
      const hash = await wallet.data.sendTransaction({
        ...tx,
        chain: sepolia,
        gas: (gas * 12n) / 10n,
        ...fees,
      });
      setMessage(`Activation submitted: ${hash}`);
      const receipt = await rpc.waitForTransactionReceipt({
        hash,
        confirmations: 2,
      });
      if (receipt.status !== "success")
        throw new Error("Activation reverted. The game remains paused.");
      const [mined, block] = await Promise.all([
        rpc.getTransaction({ hash: receipt.transactionHash }),
        rpc.getBlock({ blockNumber: receipt.blockNumber }),
      ]);
      if (
        !mined.to ||
        !isAddressEqual(mined.to, plan.to) ||
        !isAddressEqual(mined.from, plan.owner) ||
        mined.value !== 0n ||
        mined.input !== plan.data ||
        block.hash !== receipt.blockHash
      )
        throw new Error(
          "Activation receipt does not match the reviewed transaction.",
        );
      const checked = await api<{ paused: boolean }>(
        "/dev/deploy/game/activation",
        {},
      );
      if (checked.paused)
        throw new Error("The confirmed game is still paused.");
      setMessage(
        `Sepolia activation confirmed: ${receipt.transactionHash}. Open Play to begin acceptance testing.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Activation unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="acceptance-title">
      <h2 id="acceptance-title">GLOW acceptance testing</h2>
      <p>
        Activate the existing funded Sepolia game for the verified local owner
        account. Public entry remains closed. Only Sepolia test ETH pays the
        network fee.
      </p>
      <button disabled={busy} onClick={() => void activate()}>
        Review activation in MetaMask
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
