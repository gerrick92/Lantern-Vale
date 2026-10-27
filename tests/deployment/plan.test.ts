import {
  decodeFunctionData,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { expect, it } from "vitest";
import {
  readJournal,
  requireSettledJournal,
  wasUserRejected,
} from "../../apps/web/src/features/deployment/journal";
import {
  deploymentStep,
  verifyStepReceipt,
  type Artifacts,
  type CompletedStep,
} from "../../apps/web/src/features/deployment/plan";
// Minimal encoding fixtures; no transaction is sent by these unit tests.
const artifacts: Artifacts = {
  token: { abi: parseAbi(["constructor(address owner)"]), bytecode: "0x00" },
  faucet: { abi: parseAbi(["constructor(address token)"]), bytecode: "0x00" },
};
const owner = ("0x" + "1".repeat(40)) as Address;
const hash = ("0x" + "a".repeat(64)) as Hex;
const blockHash = ("0x" + "b".repeat(64)) as Hex;
const completed = [3, 4].map((n) => ({
  address: ("0x" + String(n).repeat(40)) as Address,
  hash,
})) as CompletedStep[];
it("refuses a zero owner, incomplete dependencies and legacy deployment steps", () => {
  expect(() => deploymentStep(0, artifacts, zeroAddress, [])).toThrow(
    "nonzero",
  );
  expect(() => deploymentStep(1, artifacts, owner, [])).toThrow("earlier");
  expect(() =>
    deploymentStep(2, artifacts, owner, completed.slice(0, 1)),
  ).toThrow("earlier");
  expect(() => deploymentStep(3, artifacts, owner, completed)).toThrow(
    "Invalid",
  );
});
it("encodes one zero-ETH mint of 5,000 GLOW to the faucet only", () => {
  const tx = deploymentStep(2, artifacts, owner, completed);
  const decoded = decodeFunctionData({
    abi: parseAbi(["function mint(address to,uint256 amount)"]),
    data: tx.data,
  });
  expect(tx.to).toBe(completed[0].address);
  expect(tx.value).toBe(0n);
  expect(decoded.args).toEqual([completed[1].address, 5_000n * 10n ** 18n]);
});
it("checks canonical confirmations, chain, exact call and payer independently", () => {
  const expected = deploymentStep(2, artifacts, owner, completed);
  const receipt = {
    status: "success" as const,
    blockNumber: 10n,
    blockHash,
    transactionHash: hash,
    contractAddress: null,
  };
  const tx = {
    hash,
    chainId: 11155111,
    from: owner,
    input: expected.data,
    value: 0n,
    to: expected.to!,
    blockHash,
  };
  const verify = (r = receipt, t = tx, canonical = blockHash, latest = 11n) =>
    verifyStepReceipt(expected, owner, r, t, canonical, latest);
  expect(verify()).toEqual({ hash });
  for (const change of [
    { chainId: 1 },
    { from: completed[1].address! },
    { value: 1n },
    { to: completed[1].address! },
    { input: "0x" as Hex },
    { hash: blockHash },
    { blockHash: hash },
  ])
    expect(() => verify(receipt, { ...tx, ...change })).toThrow(
      "does not match",
    );
  expect(() => verify(receipt, tx, hash)).toThrow("does not match");
  expect(() => verify(receipt, tx, blockHash, 10n)).toThrow("does not match");
  expect(() =>
    verifyStepReceipt(
      expected,
      owner,
      { ...receipt, status: "reverted" },
      tx,
      blockHash,
      11n,
    ),
  ).toThrow("does not match");
  const deploy = deploymentStep(0, artifacts, owner, []);
  const deployTx = { ...tx, input: deploy.data, to: null };
  expect(() =>
    verifyStepReceipt(deploy, owner, receipt, deployTx, blockHash, 11n),
  ).toThrow("no contract address");
  expect(
    verifyStepReceipt(
      deploy,
      owner,
      { ...receipt, contractAddress: completed[0].address! },
      deployTx,
      blockHash,
      11n,
    ),
  ).toEqual(completed[0]);
});
it("blocks ambiguous submissions, changed builds and malformed persisted receipts", () => {
  const pending = { fingerprint: "build-a", steps: [], inFlight: true };
  expect(() =>
    requireSettledJournal(readJournal(JSON.stringify(pending), "build-a")),
  ).toThrow("may already");
  expect(() => readJournal(JSON.stringify(pending), "build-b")).toThrow(
    "differs",
  );
  expect(() =>
    readJournal(
      JSON.stringify({ ...pending, steps: [{ hash: "not-a-hash" }] }),
      "build-a",
    ),
  ).toThrow("differs");
  expect(() =>
    readJournal(
      JSON.stringify({ ...pending, steps: Array(7).fill({ hash }) }),
      "build-a",
    ),
  ).toThrow("differs");
  expect(() =>
    readJournal(
      JSON.stringify({ ...pending, steps: Array(3).fill({ hash }) }),
      "build-a",
    ),
  ).toThrow("unexpected pending");
  expect(() =>
    requireSettledJournal(readJournal(null, "build-a")),
  ).not.toThrow();
});
it("only treats explicit wallet rejection as safe to retry without receipt reconciliation", () => {
  expect(wasUserRejected({ cause: { code: 4001 } })).toBe(true);
  expect(wasUserRejected({ cause: { code: -32000 } })).toBe(false);
  expect(
    wasUserRejected(new Error("Network disconnected after submission")),
  ).toBe(false);
});
