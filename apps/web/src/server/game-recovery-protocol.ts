import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

const positive = z.string().regex(/^[1-9][0-9]{0,18}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const recoveryEventSchema = z
  .object({
    userId: z.uuid(),
    sequence: positive,
    transactionId: positive,
    previousHash: hash,
    hash,
    payload: z
      .string()
      .min(1)
      .max(4 * 1024 * 1024),
  })
  .strict();
export type RecoveryEvent = z.infer<typeof recoveryEventSchema>;
const rowSchema = z
  .object({
    table: z.enum([
      "game_rounds",
      "game_actions",
      "settlement_payments",
      "game_payment_reviews",
      "game_settlement_results",
    ]),
    operation: z.enum(["INSERT", "UPDATE"]),
    row: z.record(z.string(), z.unknown()),
  })
  .strict();
export interface RecoveryStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
}
export interface RecoveryDatabase {
  read(userId: string): Promise<unknown[]>;
  acknowledge(first: RecoveryEvent, last: RecoveryEvent): Promise<void>;
}
export function validateRecoveryEvent(value: unknown, userId: string) {
  const event = recoveryEventSchema.parse(value);
  if (event.userId !== userId) throw new Error("Recovery account mismatch.");
  rowSchema.parse(JSON.parse(event.payload));
  const expected = createHash("sha256")
    .update(
      `${event.userId}:${event.sequence}:${event.previousHash}:${event.payload}`,
    )
    .digest("hex");
  if (expected !== event.hash) throw new Error("Recovery digest mismatch.");
  return event;
}
export function recoveryPrefix(
  project: string,
  stream: string,
  userId: string,
) {
  if (!/^[a-z]{20}$/.test(project))
    throw new Error("Invalid recovery project.");
  z.uuid().parse(stream);
  z.uuid().parse(userId);
  return `${project}/${stream}/${userId}`;
}
export function sealRecovery(plain: Uint8Array, key: Uint8Array, path: string) {
  if (key.length !== 32 || plain.length > 8 * 1024 * 1024)
    throw new Error("Invalid recovery envelope.");
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(path));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([
    Buffer.from("LVGR0001"),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}
export function openRecovery(bytes: Uint8Array, key: Uint8Array, path: string) {
  const envelope = Buffer.from(bytes);
  if (
    key.length !== 32 ||
    envelope.length < 37 ||
    envelope.length > 8 * 1024 * 1024 + 36 ||
    envelope.subarray(0, 8).toString() !== "LVGR0001"
  )
    throw new Error("Invalid recovery envelope.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    envelope.subarray(8, 20),
  );
  decipher.setAAD(Buffer.from(path));
  decipher.setAuthTag(envelope.subarray(20, 36));
  let pending: Buffer | undefined;
  try {
    pending = decipher.update(envelope.subarray(36));
    return Buffer.concat([pending, decipher.final()]);
  } finally {
    pending?.fill(0);
  }
}
export const recoverySequenceName = (sequence: string) =>
  positive.parse(sequence).padStart(20, "0");
async function retain(
  store: RecoveryStore,
  key: Uint8Array,
  path: string,
  value: unknown,
) {
  const bytes = Buffer.from(JSON.stringify(value));
  try {
    await store.put(path, sealRecovery(bytes, key, path));
    const recovered = openRecovery(await store.get(path), key, path);
    try {
      if (!recovered.equals(bytes))
        throw new Error("Existing recovery object differs.");
    } finally {
      recovered.fill(0);
    }
  } finally {
    bytes.fill(0);
  }
}
// Confirm only after the complete transaction batch is retained and read back.
// Database/outage retries reuse the same immutable sequence identities.
export async function retainGameActions(options: {
  database: RecoveryDatabase;
  store: RecoveryStore;
  key: Uint8Array;
  project: string;
  stream: string;
  userId: string;
}) {
  const { database, store, key, userId } = options;
  const prefix = recoveryPrefix(options.project, options.stream, userId);
  for (let batch = 0; batch < 10; batch++) {
    const values = await database.read(userId);
    if (!values.length) return;
    const events = values.map((value) => validateRecoveryEvent(value, userId));
    for (let i = 1; i < events.length; i++) {
      if (
        BigInt(events[i].sequence) !== BigInt(events[i - 1].sequence) + 1n ||
        events[i].previousHash !== events[i - 1].hash
      )
        throw new Error("Recovery sequence is incomplete.");
    }
    for (const event of events)
      await retain(
        store,
        key,
        `${prefix}/events/${recoverySequenceName(event.sequence)}.bin`,
        event,
      );
    const first = events[0],
      last = events.at(-1)!;
    await retain(
      store,
      key,
      `${prefix}/commits/${recoverySequenceName(last.sequence)}.bin`,
      {
        userId,
        through: last.sequence,
        hash: last.hash,
        transactionId: last.transactionId,
      },
    );
    await database.acknowledge(first, last);
  }
  throw new Error(
    "Recovery backlog retained in bounded batches. Retry to continue.",
  );
}
// Operator tooling uses a retained commit, never a browser-supplied checkpoint.
export async function readGameRecovery(options: {
  store: RecoveryStore;
  key: Uint8Array;
  project: string;
  stream: string;
  userId: string;
  through: string;
}) {
  const { store, key, userId, through } = options;
  const prefix = recoveryPrefix(options.project, options.stream, userId);
  const path = `${prefix}/commits/${recoverySequenceName(through)}.bin`;
  const markerBytes = openRecovery(await store.get(path), key, path);
  let marker;
  try {
    marker = z
      .object({
        userId: z.literal(userId),
        through: z.literal(through),
        hash,
        transactionId: positive,
      })
      .strict()
      .parse(JSON.parse(markerBytes.toString()));
  } finally {
    markerBytes.fill(0);
  }
  const events: RecoveryEvent[] = [];
  let previous = "0".repeat(64);
  for (let sequence = 1n; sequence <= BigInt(through); sequence++) {
    const eventPath = `${prefix}/events/${recoverySequenceName(sequence.toString())}.bin`;
    const plain = openRecovery(await store.get(eventPath), key, eventPath);
    let event;
    try {
      event = validateRecoveryEvent(JSON.parse(plain.toString()), userId);
    } finally {
      plain.fill(0);
    }
    if (
      event.sequence !== sequence.toString() ||
      event.previousHash !== previous
    )
      throw new Error("Recovery history is incomplete.");
    previous = event.hash;
    events.push(event);
  }
  if (
    previous !== marker.hash ||
    events.at(-1)?.transactionId !== marker.transactionId
  )
    throw new Error("Recovery commit mismatch.");
  return events;
}
