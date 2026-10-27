"use client";
import { useState } from "react";
import { useConnection, useReadContract, usePublicClient } from "wagmi";
import {
  erc20Abi,
  formatUnits,
  getAddress,
  parseAbiItem,
  type Hash,
} from "viem";
import { QRCodeSVG } from "qrcode.react";
import { checkedAddress, tokenAmount, contracts, CHAIN_ID } from "@/lib/chain";
import { AddressBook } from "./address-book";
import { useTransaction, TransactionStatus } from "./transactions";
import {
  clearPendingTransaction,
  readPendingTransaction,
} from "./transaction-journal";
type HistoryEntry = {
  hash: Hash;
  from: string;
  to: string;
  value: bigint;
  block: bigint;
};
export function WalletCenter() {
  const { address, chainId } = useConnection();
  return <WalletSession key={`${address ?? "disconnected"}:${chainId}`} />;
}
function WalletSession() {
  const { address, chainId } = useConnection();
  const rpc = usePublicClient({ chainId: CHAIN_ID });
  const tx = useTransaction();
  const [tab, setTab] = useState("Send");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<{
    to: `0x${string}`;
    value: bigint;
    account: string;
    chain: number;
  }>();
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyRange, setHistoryRange] = useState("");
  const balance = useReadContract({
    address: contracts.token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!contracts.token, refetchInterval: 15_000 },
  });
  function prepare() {
    try {
      if (!address || chainId !== CHAIN_ID || !contracts.token)
        throw new Error("Connect to Sepolia after GLOW deployment.");
      const to = checkedAddress(recipient);
      const value = tokenAmount(amount);
      if (balance.data === undefined || value > balance.data)
        throw new Error("Token balance is unavailable or insufficient.");
      setReview({ to, value, account: address, chain: chainId });
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Check the transfer fields.");
    }
  }
  async function confirm() {
    if (!review || review.account !== address || review.chain !== chainId) {
      setReview(undefined);
      setMessage("Your wallet or network changed. Review again.");
      return;
    }
    try {
      await tx.send({
        address: contracts.token!,
        abi: erc20Abi,
        functionName: "transfer",
        args: [review.to, review.value],
      });
      setReview(undefined);
      await balance.refetch();
    } catch {
      /* Status is shown below. */
    }
  }
  async function loadHistory() {
    try {
      if (!rpc || !address || !contracts.token)
        throw new Error("Connect your wallet after GLOW deployment.");
      const to = await rpc.getBlockNumber();
      const configured = process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK;
      const from = to > 2_000n ? to - 2_000n : 0n;
      const floor =
        configured && BigInt(configured) > from ? BigInt(configured) : from;
      const event = parseAbiItem(
        "event Transfer(address indexed from,address indexed to,uint256 value)",
      );
      const logs = await Promise.all([
        rpc.getLogs({
          address: contracts.token,
          event,
          args: { from: address },
          fromBlock: floor,
          toBlock: to,
        }),
        rpc.getLogs({
          address: contracts.token,
          event,
          args: { to: address },
          fromBlock: floor,
          toBlock: to,
        }),
      ]);
      const dedup = new Map(
        logs.flat().map((log) => [
          `${log.transactionHash}:${log.logIndex}`,
          {
            hash: log.transactionHash,
            from: log.args.from!,
            to: log.args.to!,
            value: log.args.value!,
            block: log.blockNumber,
          },
        ]),
      );
      setHistory(
        [...dedup.values()].sort((a, b) => (a.block > b.block ? -1 : 1)),
      );
      setHistoryRange(
        `Confirmed transfer events from block ${floor} to ${to}. This covers at most the latest 2,000 blocks, not your complete history.`,
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function recover() {
    try {
      if (
        !rpc ||
        !address ||
        chainId !== CHAIN_ID ||
        (await rpc.getChainId()) !== CHAIN_ID
      )
        throw new Error("Connect your wallet on Ethereum Sepolia first.");
      const hash = readPendingTransaction(address);
      if (!hash)
        throw new Error("No pending transaction is saved in this browser tab.");
      const receipt = await rpc.getTransactionReceipt({ hash });
      const confirmations =
        (await rpc.getBlockNumber()) - receipt.blockNumber + 1n;
      if (confirmations < 2n) {
        setMessage(
          "The saved transaction is mined. Waiting for two confirmations; check again shortly.",
        );
        return;
      }
      clearPendingTransaction(address, hash);
      setMessage(
        `Saved transaction ${receipt.transactionHash}: ${receipt.status === "success" ? "confirmed" : "reverted"} on Ethereum Sepolia.`,
      );
      await balance.refetch();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <div className="tabs" aria-label="Wallet section">
        {["Send", "Receive", "History", "Contacts"].map((name) => (
          <button
            key={name}
            type="button"
            className="secondary"
            aria-pressed={tab === name}
            onClick={() => {
              setTab(name);
              setMessage("");
              setReview(undefined);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "Send" && (
        <>
          <h2>Send GLOW</h2>
          <p>
            Available:{" "}
            {balance.data === undefined
              ? "Unavailable"
              : formatUnits(balance.data, 18) + " GLOW"}
          </p>
          <label htmlFor="recipient">Recipient’s full Ethereum address</label>
          <input
            id="recipient"
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setReview(undefined);
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <label htmlFor="amount">Amount in GLOW</label>
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setReview(undefined);
            }}
            autoComplete="off"
          />
          <div className="actions">
            <button
              type="button"
              disabled={tx.busy || !contracts.token}
              onClick={prepare}
            >
              Review transfer
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => void recover()}
            >
              Check a pending transaction
            </button>
          </div>
          {review && (
            <section className="status" aria-label="Transfer confirmation">
              <h3>Review before signing</h3>
              <p>
                Send {formatUnits(review.value, 18)} GLOW on Ethereum Sepolia.
              </p>
              <p className="address">To: {review.to}</p>
              <p className="address">Token: {contracts.token}</p>
              <p>
                A valid address does not confirm who owns it. MetaMask will show
                the network fee in Sepolia ETH.
              </p>
              <button
                type="button"
                disabled={
                  tx.busy ||
                  review.account !== address ||
                  review.chain !== chainId
                }
                onClick={() => void confirm()}
              >
                Confirm in MetaMask
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setReview(undefined)}
              >
                Cancel
              </button>
            </section>
          )}
          <TransactionStatus {...tx} />
        </>
      )}
      {tab === "Receive" && (
        <>
          <h2>Your receiving address</h2>
          {address ? (
            <>
              <p className="address">{getAddress(address)}</p>
              <QRCodeSVG
                value={`ethereum:${address}@11155111}`}
                size={180}
                title="Your Sepolia wallet address"
              />
              <div className="actions">
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(address)
                      .then(() => setMessage("Address copied."))
                      .catch(() =>
                        setMessage(
                          "Copy unavailable. Select the full address above.",
                        ),
                      )
                  }
                >
                  Copy address
                </button>
              </div>
              <p className="muted">
                Use Ethereum Sepolia. Do not send real-money assets for this
                game.
              </p>
            </>
          ) : (
            <p>Connect your wallet to see its address.</p>
          )}
        </>
      )}
      {tab === "History" && (
        <>
          <h2>Onchain transfer history</h2>
          <button type="button" onClick={() => void loadHistory()}>
            Read recent transfers
          </button>
          <p className="muted">
            {historyRange ||
              "Reads GLOW Transfer events directly from Sepolia. No local activity is presented as chain history."}
          </p>
          {address && (
            <a
              href={`https://sepolia.etherscan.io/address/${address}#tokentxns`}
              target="_blank"
              rel="noreferrer"
            >
              View broader history on Etherscan ↗
            </a>
          )}
          <ul>
            {history.map((row, index) => (
              <li key={`${row.hash}-${index}`}>
                <a
                  href={`https://sepolia.etherscan.io/tx/${row.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {row.from.toLowerCase() === address?.toLowerCase()
                    ? "Sent"
                    : "Received"}{" "}
                  {formatUnits(row.value, 18)} GLOW · block{" "}
                  {row.block.toString()}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === "Contacts" && (
        <AddressBook
          onUseAddress={(address) => {
            setRecipient(address);
            setReview(undefined);
            setTab("Send");
          }}
        />
      )}
      <p role="status" className={message ? "status" : ""}>
        {message}
      </p>
    </section>
  );
}
