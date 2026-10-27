import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { openBackup, sealBackup } from "../../scripts/backup-envelope.mjs";

it("restores a backup with the retained key and exact object identity", () => {
  const key = randomBytes(32);
  const plain = Buffer.from("Synthetic database archive");
  const first = sealBackup(plain, key, "project/checkpoint/database");
  const second = sealBackup(plain, key, "project/checkpoint/database");
  expect(first.equals(second)).toBe(false);
  expect(first.includes(plain)).toBe(false);
  expect(openBackup(first, key, "project/checkpoint/database")).toEqual(plain);
});

it("rejects altered ciphertext, metadata, keys and truncated envelopes", () => {
  const key = randomBytes(32);
  const saved = sealBackup(
    Buffer.from("Private fixture"),
    key,
    "project/database",
  );
  for (const offset of [0, 8, 20, 36]) {
    const altered = Buffer.from(saved);
    altered[offset] ^= 1;
    expect(() => openBackup(altered, key, "project/database")).toThrow();
  }
  expect(() =>
    openBackup(saved, randomBytes(32), "project/database"),
  ).toThrow();
  expect(() => openBackup(saved, key, "other/database")).toThrow();
  expect(() =>
    openBackup(saved.subarray(0, 36), key, "project/database"),
  ).toThrow();
});

it("rejects invalid key sizes, object contexts and oversized payloads", () => {
  const key = randomBytes(32);
  for (const context of [
    "",
    "../private",
    "account@example.com",
    "x".repeat(241),
  ])
    expect(() => sealBackup(Buffer.from("x"), key, context)).toThrow();
  expect(() =>
    sealBackup(Buffer.from("x"), Buffer.alloc(16), "backup"),
  ).toThrow();
  expect(() => sealBackup(Buffer.alloc(0), key, "backup")).toThrow();
  expect(() =>
    sealBackup(Buffer.alloc(48 * 1024 * 1024 + 1), key, "backup"),
  ).toThrow();
});
