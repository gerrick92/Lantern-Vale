import { describe, expect, it } from "vitest";
import { decodeAbiParameters, parseUnits, zeroAddress } from "viem";
import { gameDeploymentReview } from "../../scripts/prepare-game-deployment.mjs";

const fixture = () => ({
  chainId: 11155111,
  owner: "0x1000000000000000000000000000000000000001",
  tokenOwner: "0x1000000000000000000000000000000000000001",
  pendingTokenOwner: zeroAddress,
  token: "0x2000000000000000000000000000000000000002",
  faucet: "0x3000000000000000000000000000000000000003",
  faucetToken: "0x2000000000000000000000000000000000000002",
  signer: "0x4000000000000000000000000000000000000004",
  bonusTokens: "50",
  supply: parseUnits("5000", 18),
  cap: parseUnits("1000000", 18),
  artifact: {
    abi: [
      {
        type: "constructor",
        stateMutability: "nonpayable",
        inputs: ["token", "pool", "signer", "owner"].map((name) => ({
          name,
          type: "address",
        })),
      },
    ],
    bytecode: "0x60016000",
  },
});

describe("unsigned paused economy deployment review", () => {
  it("binds constructor roles and exact reserves without a funding recipient or activation", () => {
    const input = fixture();
    const review = gameDeploymentReview(input);
    const constructor =
      `0x${review.deployment.data.slice(input.artifact.bytecode.length)}` as `0x${string}`;
    expect(
      decodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "address" },
        ],
        constructor,
      ),
    ).toEqual([input.token, input.faucet, input.signer, input.owner]);
    expect(review.deployment).toMatchObject({
      from: input.owner,
      to: null,
      value: "0",
    });
    expect(review.reserveUnits).toBe("50000000000000000000");
    expect(review.status).toBe("REVIEW_ONLY");
    expect(review.funding).not.toHaveProperty("data");
    expect(review).not.toHaveProperty("unpause");
  });

  it("rejects other chains, malformed addresses, overlapping roles and a pending owner as signer", () => {
    const input = fixture();
    for (const change of [
      { chainId: 1 },
      { owner: zeroAddress },
      { signer: "0x1234" },
      { signer: input.owner },
      { signer: input.token },
      { signer: input.faucet },
      { tokenOwner: input.signer },
      { faucetToken: input.signer },
      { pendingTokenOwner: input.signer },
    ])
      expect(() => gameDeploymentReview({ ...input, ...change })).toThrow();
  });

  it("rejects unsafe reserves and numeric precision loss", () => {
    for (const bonusTokens of [
      "0",
      "1",
      "1.5",
      "-2",
      "2e3",
      " 50",
      "050",
      "995001",
      "100000000000000000000",
    ])
      expect(() =>
        gameDeploymentReview({ ...fixture(), bonusTokens }),
      ).toThrow();
    expect(() =>
      gameDeploymentReview({ ...fixture(), supply: 5000 }),
    ).toThrow();
    expect(() =>
      gameDeploymentReview({ ...fixture(), cap: parseUnits("2000000", 18) }),
    ).toThrow();
    expect(
      gameDeploymentReview({ ...fixture(), bonusTokens: "995000" })
        .reserveUnits,
    ).toBe(parseUnits("995000", 18).toString());
    expect(() =>
      gameDeploymentReview({ ...fixture(), supply: parseUnits("1000000", 18) }),
    ).toThrow();
  });

  it("changes the review fingerprint when any transaction-defining choice changes", () => {
    const initial = gameDeploymentReview(fixture()).fingerprint;
    for (const change of [
      { bonusTokens: "51" },
      { signer: "0x5000000000000000000000000000000000000005" },
      { artifact: { ...fixture().artifact, bytecode: "0x60026000" } },
    ])
      expect(
        gameDeploymentReview({ ...fixture(), ...change }).fingerprint,
      ).not.toBe(initial);
    expect(gameDeploymentReview(fixture()).fingerprint).toBe(initial);
  });

  it("rejects missing or incompatible compiled artifacts", () => {
    for (const artifact of [
      undefined,
      {},
      { abi: [], bytecode: "0x1234" },
      { ...fixture().artifact, bytecode: "0x" },
    ])
      expect(() => gameDeploymentReview({ ...fixture(), artifact })).toThrow();
  });
});
