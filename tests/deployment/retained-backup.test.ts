import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { validateRetainedManifest } from "../../scripts/retain-hosted-backup.mjs";

const label = "capture-abc123";
const sourceProject = "frbbhbkwtgqczdjfhedi";
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const fixture = () => ({
  status: "PASS",
  sourceProject,
  storageProject: "nisviqoxcfbtwccdjqoz",
  bucket: "lantern-recovery",
  artifacts: ["database", "roles"].map((object) => ({
    object: `${sourceProject}/${label}/${object}`,
    bytes: 120,
    sha256: "a".repeat(64),
    plaintextSha256: "b".repeat(64),
  })),
});

it("requires the independently retained digest, not a storage-supplied digest", () => {
  const data = fixture();
  const original = Buffer.from(JSON.stringify(data));
  expect(validateRetainedManifest(original, sha(original), label)).toEqual(
    data,
  );
  data.artifacts[0].sha256 = "c".repeat(64);
  const changed = Buffer.from(JSON.stringify(data));
  expect(() =>
    validateRetainedManifest(changed, sha(original), label),
  ).toThrow();
  expect(() => validateRetainedManifest(original, "", label)).toThrow();
});

it("rejects another project, checkpoint, path, duplicate artifact or oversized archive", () => {
  for (const change of [
    (data: ReturnType<typeof fixture>) => {
      data.sourceProject = "other";
    },
    (data: ReturnType<typeof fixture>) => {
      data.storageProject = "other";
    },
    (data: ReturnType<typeof fixture>) => {
      data.artifacts[0].object = "../private";
    },
    (data: ReturnType<typeof fixture>) => {
      data.artifacts[0].object = `${sourceProject}/capture-other1/database`;
    },
    (data: ReturnType<typeof fixture>) => {
      data.artifacts[1] = data.artifacts[0];
    },
    (data: ReturnType<typeof fixture>) => {
      data.artifacts[0].bytes = 51 * 1024 * 1024;
    },
    (data: ReturnType<typeof fixture>) => {
      data.artifacts.pop();
    },
  ]) {
    const data = fixture();
    change(data);
    const bytes = Buffer.from(JSON.stringify(data));
    expect(() => validateRetainedManifest(bytes, sha(bytes), label)).toThrow();
  }
});
