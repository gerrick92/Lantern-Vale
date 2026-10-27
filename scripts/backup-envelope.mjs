import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const magic = Buffer.from("LVBK0001");
const maximumBytes = 48 * 1024 * 1024;

function validate(key, context) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new Error("Expected a 256-bit backup encryption key.");
  if (typeof context !== "string" || !/^[a-z0-9/_-]{1,240}$/.test(context))
    throw new Error("Invalid backup object context.");
}

export function sealBackup(plain, key, context) {
  validate(key, context);
  if (
    !Buffer.isBuffer(plain) ||
    plain.length < 1 ||
    plain.length > maximumBytes
  )
    throw new Error("Backup payload exceeds the reviewed size limit.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), encrypted]);
}

export function openBackup(envelope, key, context) {
  validate(key, context);
  if (
    !Buffer.isBuffer(envelope) ||
    envelope.length < 37 ||
    envelope.length > maximumBytes + 36 ||
    !envelope.subarray(0, 8).equals(magic)
  )
    throw new Error("Invalid encrypted backup envelope.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    envelope.subarray(8, 20),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(envelope.subarray(20, 36));
  let pending;
  try {
    pending = decipher.update(envelope.subarray(36));
    return Buffer.concat([pending, decipher.final()]);
  } finally {
    pending?.fill(0);
  }
}
