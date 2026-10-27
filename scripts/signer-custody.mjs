import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { getAddress, isAddressEqual, recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sealBackup, openBackup } from "./backup-envelope.mjs";
import { vercel } from "./retain-hosted-backup.mjs";

const root = resolve(import.meta.dirname, "..");
const project = "prj_e6pw3goMLbaj0PzAfYiTky6DgUib";
const sourceProject = "frbbhbkwtgqczdjfhedi";
const storageProject = "nisviqoxcfbtwccdjqoz";
const bucket = "lantern-recovery";
const context = `signer/${sourceProject}/candidate-v1`;
const wrappingName = "LV_SIGNER_RECOVERY_KEY_V1";
const recordName = "LV_SIGNER_CUSTODY_V1";
const hash = (value) => createHash("sha256").update(value).digest("hex");
let phase = "validate custody command";

function separate(address, forbidden) {
  const normalized = getAddress(address);
  if (forbidden.some((other) => isAddressEqual(normalized, getAddress(other))))
    throw new Error("Reward signing must be separate from existing roles.");
  return normalized;
}

// Only an encrypted envelope and its public identity leave this function.
// Neither player keys nor a locally stored signing key are accepted as input.
export function createSignerCustody(wrappingKey, forbidden) {
  const secret = Buffer.from(generatePrivateKey().slice(2), "hex");
  try {
    const account = privateKeyToAccount(`0x${secret.toString("hex")}`);
    const address = separate(account.address, forbidden);
    const envelope = sealBackup(secret, wrappingKey, context);
    return {
      envelope,
      record: {
        format: 1,
        purpose: "restricted-settlement-signer",
        sourceProject,
        object: context,
        address,
        encryptedSha256: hash(envelope),
      },
    };
  } finally {
    secret.fill(0);
  }
}

export async function verifySignerCustody(
  envelope,
  wrappingKey,
  record,
  forbidden,
) {
  if (
    record.format !== 1 ||
    record.purpose !== "restricted-settlement-signer" ||
    record.sourceProject !== sourceProject ||
    record.object !== context ||
    record.encryptedSha256 !== hash(envelope)
  )
    throw new Error("Signer recovery identity or integrity mismatch.");
  const expected = separate(record.address, forbidden);
  const secret = openBackup(envelope, wrappingKey, context);
  try {
    if (secret.length !== 32) throw new Error("Invalid recovered signing key.");
    const account = privateKeyToAccount(`0x${secret.toString("hex")}`);
    if (!isAddressEqual(account.address, expected))
      throw new Error("Recovered signer differs.");
    // EIP-191 custody proof is not the contract's EIP-712 settlement protocol.
    const message = `Lantern Vale recovery verification only: ${randomBytes(32).toString("hex")}`;
    const signature = await account.signMessage({ message });
    if (
      !isAddressEqual(
        await recoverMessageAddress({ message, signature }),
        expected,
      )
    )
      throw new Error("Recovered signing proof failed.");
    return expected;
  } finally {
    secret.fill(0);
  }
}

function checked(result) {
  if (result.error) throw new Error("Private custody storage failed.");
  return result.data;
}
async function secretValue(entry, name) {
  if (
    !entry ||
    entry.key !== name ||
    entry.type !== "encrypted" ||
    entry.target?.join() !== "development"
  )
    throw new Error("Unexpected custody environment scope.");
  const value = await vercel(`/v1/projects/${project}/env/${entry.id}`);
  if (value.key !== name || typeof value.value !== "string")
    throw new Error("Custody configuration unavailable.");
  return value.value;
}
async function storeValue(name, value) {
  await vercel(`/v10/projects/${project}/env`, "POST", {
    key: name,
    value,
    type: "encrypted",
    target: ["development"],
    comment:
      "Restricted signer recovery only. Preserve with the private encrypted custody object. Never expose in browser code or copy into app environments.",
  });
}
async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["--prepare", "--verify"].includes(mode))
    throw new Error(
      "Expected --prepare or --verify; neither deploys or enables signing.",
    );
  const deployment = JSON.parse(
    readFileSync(resolve(root, "deployments/sepolia.json"), "utf8"),
  );
  if (
    deployment.chainId !== 11155111 ||
    deployment.plan !== "lantern-vale-token-faucet-v1"
  )
    throw new Error("Unexpected existing deployment.");
  const forbidden = [
    deployment.owner,
    ...deployment.steps.slice(0, 2).map((step) => step.address),
  ];
  const env = parseEnv(
    readFileSync(resolve(root, "apps/web/.env.staging.local"), "utf8"),
  );
  if (
    env.NEXT_PUBLIC_SUPABASE_URL !== `https://${storageProject}.supabase.co` ||
    !env.SUPABASE_SECRET_KEY
  )
    throw new Error("Unexpected custody storage target.");
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const anonymous = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  phase = "verify provider custody configuration";
  if (checked(await client.storage.getBucket(bucket)).public)
    throw new Error("Custody bucket must be private.");
  let entries = (await vercel(`/v9/projects/${project}/env`)).envs;
  let wrapping = entries.find((entry) => entry.key === wrappingName);
  let identity = entries.find((entry) => entry.key === recordName);
  if (!!wrapping !== !!identity)
    throw new Error(
      "Partial custody requires review; never silently replace a signing key.",
    );
  if (!wrapping) {
    if (mode !== "--prepare")
      throw new Error("Signer custody is not prepared.");
    // A failed/ambiguous upload cannot be followed by generating another key.
    const objects = checked(
      await client.storage
        .from(bucket)
        .list(`signer/${sourceProject}`, { limit: 100 }),
    );
    if (objects.some((object) => object.name === "candidate-v1"))
      throw new Error("An existing custody object requires recovery review.");
    phase = "prepare new independent encrypted signer custody";
    const wrappingKey = randomBytes(32);
    try {
      const candidate = createSignerCustody(wrappingKey, forbidden);
      await storeValue(wrappingName, wrappingKey.toString("hex"));
      checked(
        await client.storage.from(bucket).upload(context, candidate.envelope, {
          contentType: "application/octet-stream",
          upsert: false,
        }),
      );
      await storeValue(recordName, JSON.stringify(candidate.record));
    } finally {
      wrappingKey.fill(0);
    }
    entries = (await vercel(`/v9/projects/${project}/env`)).envs;
    wrapping = entries.find((entry) => entry.key === wrappingName);
    identity = entries.find((entry) => entry.key === recordName);
  }
  phase = "independently retrieve and verify signer recovery";
  // Both inputs are retrieved from their providers; no local candidate/key is reused.
  const encoded = await secretValue(wrapping, wrappingName);
  if (!/^[a-f0-9]{64}$/.test(encoded)) throw new Error("Invalid recovery key.");
  const wrappingKey = Buffer.from(encoded, "hex");
  let address;
  const record = JSON.parse(await secretValue(identity, recordName));
  try {
    const blob = checked(await client.storage.from(bucket).download(context));
    if (blob.size !== 68) throw new Error("Unexpected custody envelope size.");
    address = await verifySignerCustody(
      Buffer.from(await blob.arrayBuffer()),
      wrappingKey,
      record,
      forbidden,
    );
  } finally {
    wrappingKey.fill(0);
  }
  const denied = await anonymous.storage.from(bucket).download(context);
  if (!denied.error)
    throw new Error("Anonymous custody access was not denied.");
  const publicResponse = await fetch(
    client.storage.from(bucket).getPublicUrl(context).data.publicUrl,
    { signal: AbortSignal.timeout(15000), redirect: "error" },
  );
  await publicResponse.body?.cancel();
  if (publicResponse.ok)
    throw new Error("Public custody access was not denied.");
  const report = {
    ...record,
    address,
    verifiedAt: new Date().toISOString(),
    status: "CUSTODY_VERIFIED",
    storageProject,
    bucket,
    recoveryKeyLocation: `Vercel ${project}: ${wrappingName}, development only`,
    trustedIdentityLocation: `Vercel ${project}: ${recordName}, development only`,
    checks: [
      "remote authenticated decryption",
      "recovered signing proof",
      "separate signing role",
      "anonymous and public access denied",
    ],
    limits: [
      "Function provisioning is recorded separately in signer-provisioning.json",
      "Custody verification does not deploy an economy, enable signing or issue settlements",
      "No player key accessed",
      "Provider account recovery and paid outage drill remain separate",
    ],
  };
  writeFileSync(
    resolve(root, "deployments/signer-custody.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `PASS: encrypted signer custody and recovery verified for ${address}. This check does not enable signing.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      `BLOCKED: ${phase}; private diagnostics suppressed. Never retry by replacing existing custody.`,
    );
    process.exitCode = 1;
  });
