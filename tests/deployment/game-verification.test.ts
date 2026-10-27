import { describe, expect, it } from "vitest";
import { encodeAbiParameters, parseUnits, zeroAddress } from "viem";
import { gameDeploymentFixture, fixtureHash } from "../helpers/game-deployment";
import { validateGameReview } from "../../apps/web/src/features/deployment/game-plan";
import {
  verifyGameDeployment,
  verifyGameRuntime,
} from "../../apps/web/src/features/deployment/game-verification";

describe("independent paused game deployment verification", () => {
  it.each([false, true])(
    "verifies an exact confirmed deployment with funding=%s without sending anything",
    async (funded) => {
      const f = gameDeploymentFixture(funded);
      const result = await verifyGameDeployment(
        f.rpc,
        f.plan,
        f.artifact,
        f.hashes,
      );
      expect(result).toMatchObject({
        status: "PASS",
        stage: funded ? "PAUSED_AND_FUNDED" : "PAUSED_DEPLOYMENT",
        economy: f.economy,
        paused: true,
        paidPlayEnabled: false,
        balance: funded ? f.plan.reserveUnits : "0",
      });
      expect(result.fundingTransaction === null).toBe(funded);
      for (const [request] of f.mock.readContract.mock.calls)
        expect(request).toHaveProperty("blockNumber", 103n);
    },
  );

  it("binds the saved review to both artifacts and public deployment/custody records", () => {
    const f = gameDeploymentFixture();
    const artifact = { abi: f.artifact.abi, bytecode: f.artifact.bytecode };
    const roles = {
      owner: f.plan.owner,
      token: f.plan.token,
      faucet: f.plan.faucet,
      signer: f.plan.signer,
    };
    expect(validateGameReview(f.plan, artifact, roles)).toEqual(f.plan);
    for (const changed of [
      { ...f.plan, signer: f.plan.owner },
      { ...f.plan, bonusTokens: "101" },
      { ...f.plan, reserveUnits: "1" },
      { ...f.plan, status: "APPROVED" },
      { ...f.plan, deployment: { ...f.plan.deployment, value: "1" } },
      { ...f.plan, fingerprint: "0".repeat(64) },
      { ...f.plan, blockHash: "invalid" },
    ])
      expect(() => validateGameReview(changed, artifact, roles)).toThrow();
    expect(() =>
      validateGameReview(f.plan, { ...artifact, bytecode: "0x6002" }, roles),
    ).toThrow();
    expect(() =>
      validateGameReview(f.plan, artifact, { ...roles, signer: f.plan.token }),
    ).toThrow();
  });

  it.each([
    ["chainId", 1],
    ["from", zeroAddress],
    ["to", zeroAddress],
    ["value", 1n],
    ["input", "0x6002"],
    ["hash", fixtureHash("f")],
    ["blockHash", fixtureHash("f")],
    ["blockNumber", 99n],
    ["transactionIndex", 3],
    ["nonce", 2],
  ])("rejects a changed deployment transaction %s", async (field, value) => {
    const f = gameDeploymentFixture();
    Object.assign(f.tx, { [field as string]: value });
    await expect(
      verifyGameDeployment(f.rpc, f.plan, f.artifact, f.hashes),
    ).rejects.toThrow();
  });

  it.each([
    ["status", "reverted"],
    ["from", zeroAddress],
    ["to", zeroAddress],
    ["contractAddress", zeroAddress],
    ["transactionHash", fixtureHash("f")],
    ["blockHash", fixtureHash("f")],
    ["transactionIndex", 2],
  ])("rejects a changed deployment receipt %s", async (field, value) => {
    const f = gameDeploymentFixture();
    Object.assign(f.deployment, { [field as string]: value });
    await expect(
      verifyGameDeployment(f.rpc, f.plan, f.artifact, f.hashes),
    ).rejects.toThrow();
  });

  it.each([
    ["token", zeroAddress],
    ["recyclingPool", zeroAddress],
    ["signer", zeroAddress],
    ["owner", zeroAddress],
    ["pendingOwner", "0x5000000000000000000000000000000000000005"],
    ["paused", false],
    ["nextRoundId", 2n],
    ["escrowed", 1n],
    ["bonusReserved", 1n],
    ["availableBonusPool", 0n],
    ["balanceOf", 0n],
    ["totalSupply", parseUnits("1000001", 18)],
    ["cap", parseUnits("2000000", 18)],
    [
      "eip712Domain",
      [
        "0x0f",
        "DifferentDomain",
        "1",
        11155111n,
        zeroAddress,
        fixtureHash("0"),
        [],
      ],
    ],
  ])("rejects changed deployed state %s", async (field, value) => {
    const f = gameDeploymentFixture(true);
    f.states[field as string] = value;
    await expect(
      verifyGameDeployment(f.rpc, f.plan, f.artifact, f.hashes),
    ).rejects.toThrow();
  });

  it("rejects wrong-chain RPC, missing confirmations and a mid-check reorg", async () => {
    for (const kind of ["chain", "confirmation", "reorg"]) {
      const f = gameDeploymentFixture();
      if (kind === "chain") f.mock.getChainId.mockResolvedValue(1);
      if (kind === "confirmation")
        f.mock.getBlockNumber.mockResolvedValue(100n);
      if (kind === "reorg") {
        let reads = 0;
        f.mock.getBlock.mockImplementation(async ({ blockNumber }) => ({
          number: blockNumber,
          hash:
            blockNumber === 100n
              ? ++reads === 1
                ? fixtureHash("a")
                : fixtureHash("d")
              : fixtureHash("c"),
        }));
      }
      await expect(
        verifyGameDeployment(f.rpc, f.plan, f.artifact, f.hashes),
      ).rejects.toThrow();
    }
  });

  it("rejects wrong reserve mint calldata, recipient, event, amount and token", async () => {
    for (const kind of [
      "input",
      "recipient",
      "amount",
      "token",
      "missing",
      "duplicate",
      "removed",
      "hash",
      "balance",
    ]) {
      const f = gameDeploymentFixture(true);
      if (kind === "input") f.fundingTx.input = "0x1234";
      if (kind === "recipient")
        f.funding.logs[0].topics[2] = `0x${"0".repeat(64)}`;
      if (kind === "amount")
        f.funding.logs[0].data = encodeAbiParameters(
          [{ type: "uint256" }],
          [1n],
        );
      if (kind === "token") f.funding.logs[0].address = f.plan.faucet;
      if (kind === "missing") f.funding.logs = [];
      if (kind === "duplicate") f.funding.logs.push({ ...f.funding.logs[0] });
      if (kind === "removed") f.funding.logs[0].removed = true;
      if (kind === "hash") f.funding.logs[0].blockHash = fixtureHash("d");
      if (kind === "balance") f.states.balanceOf = parseUnits("101", 18);
      await expect(
        verifyGameDeployment(f.rpc, f.plan, f.artifact, f.hashes),
        kind,
      ).rejects.toThrow();
    }
  });

  it("rejects unexpected prefunding and insufficient remaining mint capacity", async () => {
    const f = gameDeploymentFixture();
    f.states.balanceOf = 1n;
    await expect(
      verifyGameDeployment(f.rpc, f.plan, f.artifact, f.hashes),
    ).rejects.toThrow(/Reconcile/);
    f.states.balanceOf = 0n;
    f.states.totalSupply = parseUnits("999999", 18);
    await expect(
      verifyGameDeployment(f.rpc, f.plan, f.artifact, f.hashes),
    ).rejects.toThrow(/capacity/);
  });

  it("rejects different runtime, missing dependencies and a contract signer", async () => {
    for (const target of ["economy", "token", "faucet", "signer"] as const) {
      const f = gameDeploymentFixture();
      const original = f.mock.getCode.getMockImplementation()!;
      f.mock.getCode.mockImplementation(async (args) =>
        args.address === (target === "economy" ? f.economy : f.plan[target])
          ? target === "signer"
            ? "0x6001"
            : "0x"
          : original(args),
      );
      await expect(
        verifyGameDeployment(f.rpc, f.plan, f.artifact, f.hashes),
      ).rejects.toThrow();
    }
    const { artifact } = gameDeploymentFixture();
    expect(() =>
      verifyGameRuntime(
        artifact.runtime.replace("6001", "6002") as `0x${string}`,
        artifact,
      ),
    ).toThrow(/differs/);
    expect(() =>
      verifyGameRuntime(artifact.runtime, {
        ...artifact,
        immutables: { one: [{ start: 99999, length: 32 }] },
      }),
    ).toThrow(/references/);
    expect(() =>
      verifyGameRuntime(artifact.runtime, {
        ...artifact,
        immutables: {
          one: [
            { start: 2, length: 32 },
            { start: 2, length: 32 },
          ],
        },
      }),
    ).toThrow(/overlap/);
  });
});
