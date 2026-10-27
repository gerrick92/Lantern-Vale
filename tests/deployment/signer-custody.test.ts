import { createHash, randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import {
  createSignerCustody,
  verifySignerCustody,
} from "../../scripts/signer-custody.mjs";

const owner = "0x7777777777777777777777777777777777777777";

it("recovers and proves the same separate signer using only its encrypted envelope", async () => {
  const wrappingKey = randomBytes(32);
  const custody = createSignerCustody(wrappingKey, [owner]);
  expect(Object.keys(custody).sort()).toEqual(["envelope", "record"]);
  expect(custody.envelope.length).toBe(68);
  expect(custody.record.address).not.toBe(owner);
  const recovered = await verifySignerCustody(
    Buffer.from(custody.envelope),
    Buffer.from(wrappingKey),
    structuredClone(custody.record),
    [owner],
  );
  expect(recovered).toBe(custody.record.address);
  expect(createSignerCustody(wrappingKey, [owner]).record.address).not.toBe(
    recovered,
  );
});

it("rejects changed custody identity, owner role, wrapping key and ciphertext", async () => {
  const wrappingKey = randomBytes(32);
  const { envelope, record } = createSignerCustody(wrappingKey, [owner]);
  for (const changed of [
    { ...record, sourceProject: "other" },
    { ...record, object: "signer/other/candidate-v1" },
    { ...record, purpose: "general-signer" },
    { ...record, address: owner },
    { ...record, address: "0x6666666666666666666666666666666666666666" },
  ])
    await expect(
      verifySignerCustody(envelope, wrappingKey, changed, [owner]),
    ).rejects.toThrow();
  await expect(
    verifySignerCustody(envelope, wrappingKey, record, [record.address]),
  ).rejects.toThrow();
  await expect(
    verifySignerCustody(envelope, randomBytes(32), record, [owner]),
  ).rejects.toThrow();
  const altered = Buffer.from(envelope);
  altered[50] ^= 1;
  const forged = {
    ...record,
    encryptedSha256: createHash("sha256").update(altered).digest("hex"),
  };
  await expect(
    verifySignerCustody(altered, wrappingKey, forged, [owner]),
  ).rejects.toThrow();
});
