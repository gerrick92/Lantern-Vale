import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { openBackup, sealBackup } from "./backup-envelope.mjs";
import { checkArchive, protectArchive } from "./hosted-backup.mjs";

const root = resolve(import.meta.dirname, "..");
const project = "prj_e6pw3goMLbaj0PzAfYiTky6DgUib";
const bucket = "lantern-recovery";
const sourceProject = "frbbhbkwtgqczdjfhedi";
const storageProject = "nisviqoxcfbtwccdjqoz";
const keyName = "LV_BACKUP_RECOVERY_KEY_V1";
const sha = (value) => createHash("sha256").update(value).digest("hex");
let phase = "validate checkpoint";

// Use the user's already authorized official CLI. Never emit responses or keys.
export async function vercel(path, method = "GET", body) {
  const args = [
    resolve(root, ".tools/vercel/node_modules/vercel/dist/index.js"),
    "api",
    path,
    "--method",
    method,
    "--scope",
    "lantern-vale",
    "--global-config",
    resolve(root, ".tools/private/vercel"),
  ];
  if (body) args.push("--input", "-");
  // Vercel prints its version to stderr even on success; capture it privately.
  const { spawn } = await import("node:child_process");
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => child.kill(), 45_000);
    child.stdout.on("data", (data) => {
      output += data.toString();
      if (output.length > 1_000_000) child.kill();
    });
    child.stderr.on("data", () => {});
    child.on("error", () => reject(new Error("Vercel access unavailable.")));
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error("Vercel request failed."));
      try {
        done(JSON.parse(output));
      } catch {
        reject(new Error("Invalid Vercel response."));
      }
      output = "";
    });
    child.stdin.end(body ? JSON.stringify(body) : undefined);
  });
}

async function remoteKey(create) {
  let entry = (await vercel(`/v9/projects/${project}/env`)).envs.find(
    (e) => e.key === keyName,
  );
  if (!entry) {
    if (!create)
      throw new Error(
        "Recovery key missing; never replace it for an existing archive.",
      );
    const key = randomBytes(32);
    try {
      await vercel(`/v10/projects/${project}/env`, "POST", {
        key: keyName,
        value: key.toString("hex"),
        type: "encrypted",
        target: ["development"],
        comment:
          "Database backup recovery only. Retain independently of this PC. Never expose to browser code or remove while retained backups exist.",
      });
    } finally {
      key.fill(0);
    }
    entry = (await vercel(`/v9/projects/${project}/env`)).envs.find(
      (e) => e.key === keyName,
    );
  }
  if (
    !entry ||
    entry.type !== "encrypted" ||
    entry.target?.join() !== "development"
  )
    throw new Error(
      "Recovery key scope differs from the reviewed configuration.",
    );
  const result = await vercel(`/v1/projects/${project}/env/${entry.id}`);
  if (result.key !== keyName || !/^[a-f0-9]{64}$/.test(result.value ?? ""))
    throw new Error("Recovery key could not be retrieved privately.");
  return Buffer.from(result.value, "hex");
}

function checked(result) {
  if (result.error) throw new Error("Private storage operation failed.");
  return result.data;
}

export function validateRetainedManifest(bytes, trustedDigest, label) {
  if (
    !/^capture-[a-z0-9]{6}$/.test(label) ||
    bytes.length > 64 * 1024 ||
    !/^[a-f0-9]{64}$/.test(trustedDigest) ||
    sha(bytes) !== trustedDigest
  )
    throw new Error("Retained manifest authentication failed.");
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (
    manifest.status !== "PASS" ||
    manifest.sourceProject !== sourceProject ||
    manifest.storageProject !== storageProject ||
    manifest.bucket !== bucket ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== 2
  )
    throw new Error("Unexpected retained checkpoint.");
  for (const [index, object] of ["database", "roles"].entries()) {
    const artifact = manifest.artifacts[index];
    if (
      artifact.object !== `${sourceProject}/${label}/${object}` ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 37 ||
      artifact.bytes > 50 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      !/^[a-f0-9]{64}$/.test(artifact.plaintextSha256)
    )
      throw new Error("Unexpected retained artifact.");
  }
  return manifest;
}

async function recover(admin, label) {
  if (!/^capture-[a-z0-9]{6}$/.test(label))
    throw new Error("Expected the retained lowercase checkpoint name.");
  phase = "retrieve trusted checkpoint digest";
  const name = `LV_BACKUP_CHECKPOINT_${label.replaceAll("-", "_").toUpperCase()}`;
  const entry = (await vercel(`/v9/projects/${project}/env`)).envs.find(
    (e) => e.key === name,
  );
  if (
    !entry ||
    entry.type !== "encrypted" ||
    entry.target?.join() !== "development"
  )
    throw new Error("Trusted checkpoint digest is unavailable.");
  const digest = await vercel(`/v1/projects/${project}/env/${entry.id}`);
  if (digest.key !== name) throw new Error("Checkpoint identity changed.");
  phase = "authenticate remote checkpoint";
  const manifestBlob = checked(
    await admin.storage
      .from(bucket)
      .download(`${sourceProject}/${label}/manifest`),
  );
  if (manifestBlob.size > 64 * 1024)
    throw new Error("Manifest exceeds size limit.");
  const bytes = Buffer.from(await manifestBlob.arrayBuffer());
  const manifest = validateRetainedManifest(bytes, digest.value, label);
  const key = await remoteKey(false);
  const protectedArtifacts = [];
  try {
    for (const [index, artifact] of manifest.artifacts.entries()) {
      phase = "recover encrypted archive from private storage";
      const downloaded = checked(
        await admin.storage.from(bucket).download(artifact.object),
      );
      if (downloaded.size !== artifact.bytes)
        throw new Error("Archive size mismatch.");
      const encrypted = Buffer.from(await downloaded.arrayBuffer());
      if (sha(encrypted) !== artifact.sha256)
        throw new Error("Archive digest mismatch.");
      const plain = openBackup(encrypted, key, artifact.object);
      try {
        if (sha(plain) !== artifact.plaintextSha256)
          throw new Error("Plaintext digest mismatch.");
        if (index === 0) await checkArchive(plain);
        protectedArtifacts.push({
          file: index === 0 ? "database.dump.dpapi" : "roles.sql.dpapi",
          data: await protectArchive(plain),
        });
      } finally {
        plain.fill(0);
      }
    }
  } finally {
    key.fill(0);
  }
  // No local checkpoint is read, replaced or required. Only encrypted output
  // is written; the native restore command still targets a disposable clone.
  const base = resolve(root, "test-results/hosted-backup");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(resolve(base, "capture-"));
  for (const artifact of protectedArtifacts)
    writeFileSync(resolve(directory, artifact.file), artifact.data, {
      flag: "wx",
    });
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify(
      {
        format: 1,
        checkedAt: new Date().toISOString(),
        sourceProject,
        status: "CAPTURED_NOT_RESTORED",
        recoveredFrom: `${storageProject}/${bucket}/${sourceProject}/${label}`,
        trustedManifestSha256: digest.value,
        protection:
          "Windows DPAPI CurrentUser, re-encrypted after cloud recovery",
        artifacts: protectedArtifacts.map((a) => ({
          file: a.file,
          encryptedBytes: a.data.length,
          encryptedSha256: sha(a.data),
        })),
        limitations: [
          "Native restore is a separate check",
          "No hosted Auth recovery or post-checkpoint write recovery",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    `PASS: independently authenticated cloud checkpoint recovered to ${directory}`,
  );
}

async function main() {
  const recovering = process.argv[2] === "--recover";
  if (
    process.argv.length !== 4 ||
    (!recovering && process.argv[2] !== "--retain")
  )
    throw new Error(
      "Expected --retain <reviewed checkpoint directory> or --recover <retained lowercase checkpoint name>.",
    );
  const directory = recovering
    ? undefined
    : realpathSync(resolve(process.argv[3]));
  if (
    !recovering &&
    dirname(directory) !==
      realpathSync(resolve(root, "test-results/hosted-backup"))
  )
    throw new Error("Checkpoint is outside the backup directory.");
  const label = recovering
    ? process.argv[3]
    : basename(directory).toLowerCase();
  if (!/^capture-[a-z0-9]{6}$/.test(label))
    throw new Error("Unexpected checkpoint name.");
  const manifest = recovering
    ? undefined
    : JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
  if (
    !recovering &&
    (manifest.status !== "CAPTURED_NOT_RESTORED" ||
      manifest.sourceProject !== sourceProject)
  )
    throw new Error("Unexpected backup source.");
  const settings = parseEnv(
    readFileSync(resolve(root, "apps/web/.env.staging.local"), "utf8"),
  );
  if (
    settings.NEXT_PUBLIC_SUPABASE_URL !==
      `https://${storageProject}.supabase.co` ||
    !settings.SUPABASE_SECRET_KEY
  )
    throw new Error("Recovery storage target changed.");
  const clientOptions = {
    auth: { persistSession: false, autoRefreshToken: false },
  };
  const admin = createClient(
    settings.NEXT_PUBLIC_SUPABASE_URL,
    settings.SUPABASE_SECRET_KEY,
    clientOptions,
  );
  if (recovering) {
    const savedBucket = checked(await admin.storage.getBucket(bucket));
    if (savedBucket.public) throw new Error("Recovery storage is public.");
    await recover(admin, label);
    return;
  }
  const anonymous = createClient(
    settings.NEXT_PUBLIC_SUPABASE_URL,
    settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    clientOptions,
  );
  phase = "verify private storage";
  const buckets = checked(await admin.storage.listBuckets());
  const existing = buckets.find((b) => b.id === bucket);
  if (existing?.public)
    throw new Error("Recovery bucket must never be public.");
  if (!existing)
    checked(
      await admin.storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: 50 * 1024 * 1024,
        allowedMimeTypes: ["application/octet-stream"],
      }),
    );
  const verifiedBucket = checked(await admin.storage.getBucket(bucket));
  if (verifiedBucket.public) throw new Error("Recovery storage is public.");

  phase = "retain encryption key separately";
  let key = await remoteKey(true);
  const artifacts = [];
  try {
    for (const [file, object] of [
      ["database.dump.dpapi", "database"],
      ["roles.sql.dpapi", "roles"],
    ]) {
      phase = `retain encrypted ${object}`;
      const protectedBytes = readFileSync(resolve(directory, file));
      if (
        sha(protectedBytes) !==
        manifest.artifacts.find((a) => a.file === file)?.encryptedSha256
      )
        throw new Error("Checkpoint integrity mismatch.");
      const plain = await protectArchive(protectedBytes, "Unprotect");
      const context = `${sourceProject}/${label}/${object}`;
      let envelope;
      try {
        envelope = sealBackup(plain, key, context);
        checked(
          await admin.storage.from(bucket).upload(context, envelope, {
            contentType: "application/octet-stream",
            upsert: false,
          }),
        );
        artifacts.push({
          object: context,
          bytes: envelope.length,
          sha256: sha(envelope),
          plaintextSha256: sha(plain),
        });
      } finally {
        plain.fill(0);
      }
    }
  } finally {
    key.fill(0);
  }

  // Discard the original key, then retrieve both the key and ciphertext from
  // their providers. Verification cannot silently fall back to a local copy.
  phase = "recover from both providers";
  key = await remoteKey(false);
  try {
    for (const artifact of artifacts) {
      const downloaded = checked(
        await admin.storage.from(bucket).download(artifact.object),
      );
      const bytes = Buffer.from(await downloaded.arrayBuffer());
      if (sha(bytes) !== artifact.sha256)
        throw new Error("Remote archive digest differs.");
      const plain = openBackup(bytes, key, artifact.object);
      try {
        if (sha(plain) !== artifact.plaintextSha256)
          throw new Error("Recovered plaintext digest differs.");
        if (artifact.object.endsWith("/database")) await checkArchive(plain);
      } finally {
        plain.fill(0);
      }
      const denied = await anonymous.storage
        .from(bucket)
        .download(artifact.object);
      if (!denied.error)
        throw new Error("Anonymous access to recovery storage was not denied.");
      const publicUrl = admin.storage.from(bucket).getPublicUrl(artifact.object)
        .data.publicUrl;
      const publicResponse = await fetch(publicUrl, {
        signal: AbortSignal.timeout(15_000),
      });
      if (publicResponse.ok)
        throw new Error("Public recovery object URL unexpectedly succeeded.");
      await publicResponse.body?.cancel();
    }
  } finally {
    key.fill(0);
  }
  const report = {
    status: "PASS",
    checkedAt: new Date().toISOString(),
    sourceProject,
    storageProject,
    bucket,
    encryption:
      "AES-256-GCM with per-object nonce and authenticated object identity",
    keyLocation: `Vercel ${project}: ${keyName}, development only, encrypted at rest`,
    artifacts,
    verified: [
      "remote ciphertext read-back",
      "separate provider key retrieval",
      "archive decryption and format",
      "anonymous and public URL denial",
    ],
    limitations: [
      "No post-checkpoint action recovery or hosted Auth restoration is established",
      "Both provider accounts must remain accessible",
      "Retention is manual; no scheduled backup is claimed",
    ],
  };
  const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
  phase = "retain independently authenticated checkpoint digest";
  await vercel(`/v10/projects/${project}/env`, "POST", {
    key: `LV_BACKUP_CHECKPOINT_${label.replaceAll("-", "_").toUpperCase()}`,
    value: sha(reportBytes),
    type: "encrypted",
    target: ["development"],
    comment:
      "Trusted retained backup manifest SHA-256; preserve with the recovery key.",
  });
  // The manifest contains only integrity metadata, never account rows or keys.
  checked(
    await admin.storage
      .from(bucket)
      .upload(`${sourceProject}/${label}/manifest`, reportBytes, {
        contentType: "application/octet-stream",
        upsert: false,
      }),
  );
  writeFileSync(resolve(directory, "offsite.json"), reportBytes, {
    flag: "wx",
  });
  console.log(
    `PASS: encrypted checkpoint retained and recovered from private staging storage; report ${directory}/offsite.json`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      `BLOCKED: ${phase}; private response suppressed. Retained objects are not deleted automatically.`,
    );
    process.exitCode = 1;
  });
