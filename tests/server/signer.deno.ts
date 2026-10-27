import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { configuredHandler } from "../../supabase/functions/settlement-signer/runtime.ts";
import { createSignerHandler } from "../../supabase/functions/settlement-signer/handler.ts";
import { resultTypes } from "../../supabase/functions/settlement-signer/policy.ts";

Deno.test(
  "disabled Deno entry does not read a signing key or contact services",
  async () => {
    const names: string[] = [];
    const handler = configuredHandler((name) => {
      names.push(name);
      return undefined;
    });
    assert.equal(
      (await handler(new Request("https://fixture.invalid"))).status,
      503,
    );
    assert.deepEqual(names, ["LV_SIGNING_ENABLED", "LV_SIGNER_TOKEN"]);
  },
);

Deno.test(
  "native HTTP handler signs only the verified fixture and returns no credentials",
  async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const policy = {
      contract: "0x3333333333333333333333333333333333333333",
      token: "0x4444444444444444444444444444444444444444",
      pool: "0x5555555555555555555555555555555555555555",
      signer: signer.address,
    } as const;
    const player = "0x6666666666666666666666666666666666666666";
    const owner = "0x7777777777777777777777777777777777777777";
    const serviceToken = "ephemeral-fixture-service-token-not-a-secret";
    const result = {
      domain: {
        name: "LanternValeSettlement",
        version: "1",
        chainId: 11155111,
        verifyingContract: policy.contract,
      },
      types: resultTypes,
      primaryType: "Result" as const,
      message: {
        roundId: 7n,
        player,
        deposited: 10n ** 18n,
        won: true,
        fullClear: false,
        deadline: 13600n,
      },
    } as const;
    const handler = createSignerHandler({
      enabled: true,
      token: serviceToken,
      policy,
      now: () => 10000,
      loadRound: async () => ({
        chain_id: 11155111,
        gateway_address: policy.contract,
        contract_round_id: "7",
        wallet_address: player,
        economy_version: "settlement-v1",
        class: "warrior",
        state: {
          rulesVersion: 5,
          mode: "paid",
          demo: false,
          phase: "victory",
          classId: "warrior",
          hp: 10,
          enemyHp: 0,
          encounter: 5,
          cleared: [5],
          spent: 1,
        },
      }),
      readChain: async () => ({
        ...policy,
        chainId: 11155111,
        timestamp: 10000n,
        blockHash: `0x${"ab".repeat(32)}`,
        poolToken: policy.token,
        owner,
        tokenOwner: owner,
        player,
        deposited: 10n ** 18n,
        settled: false,
        classId: 0,
      }),
      recheck: async () => {},
      sign: (value) => signer.signTypedData(value),
    });
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      handler,
    );
    try {
      const url = `http://127.0.0.1:${server.addr.port}`;
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      };
      const body = JSON.stringify(result, (_key, value) =>
        typeof value === "bigint" ? String(value) : value,
      );
      const denied = await fetch(url, { method: "POST", body });
      assert.equal(denied.status, 401);
      await denied.body?.cancel();
      const response = await fetch(url, { method: "POST", headers, body });
      assert.equal(response.status, 200);
      const signed = await response.json();
      assert.deepEqual(Object.keys(signed), ["signature"]);
      assert.equal(
        await recoverTypedDataAddress({
          ...result,
          signature: signed.signature,
        }),
        signer.address,
      );
    } finally {
      await server.shutdown();
    }
  },
);
