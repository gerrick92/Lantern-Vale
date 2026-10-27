import { timingSafeEqual } from "node:crypto";
import type { Hex } from "viem";
import {
  parseResult,
  verifyEvidence,
  type ChainEvidence,
  type Policy,
  type SigningResult,
} from "./policy.ts";

export type SignerDependencies = {
  enabled: boolean;
  token: string;
  policy: Policy;
  now: () => number;
  loadRound: (roundId: bigint) => Promise<unknown>;
  readChain: (roundId: bigint) => Promise<ChainEvidence>;
  recheck: (evidence: ChainEvidence) => Promise<void>;
  sign: (result: SigningResult) => Promise<Hex>;
};
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function reply(status: number, error: string) {
  return Response.json({ error }, { status, headers });
}
async function readJson(request: Request) {
  if (
    !request.body ||
    Number(request.headers.get("content-length") || 0) > 4096
  )
    throw new Error();
  const reader = request.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 2000);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error();
      parts.push(value);
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (timedOut) throw new Error();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createServiceGuard(token: string) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
    throw new Error("Invalid service configuration");
  const expected = new TextEncoder().encode(`Bearer ${token}`);
  return (request: Request): Response | undefined => {
    if (request.method !== "POST") return reply(405, "POST required.");
    // No browser CORS access, query parameters, forwarding or arbitrary signing methods.
    if (new URL(request.url).search || request.headers.has("origin"))
      return reply(400, "Invalid signing request.");
    const received = new TextEncoder().encode(
      request.headers.get("authorization") || "",
    );
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      return reply(401, "Service authentication required.");
    return undefined;
  };
}

export function createSignerHandler(deps: SignerDependencies) {
  const guard = createServiceGuard(deps.token);
  return async (request: Request): Promise<Response> => {
    const rejected = guard(request);
    if (rejected) return rejected;
    if (!deps.enabled) return reply(503, "Signing is disabled.");
    if (
      !/^application\/json(?:\s*;.*)?$/i.test(
        request.headers.get("content-type") || "",
      ) ||
      request.headers.has("content-encoding")
    )
      return reply(415, "JSON required.");
    let result: SigningResult;
    try {
      result = parseResult(await readJson(request), deps.policy.contract);
    } catch {
      return reply(400, "Invalid settlement result.");
    }
    try {
      const [round, chain] = await Promise.all([
        deps.loadRound(result.message.roundId),
        deps.readChain(result.message.roundId),
      ]);
      verifyEvidence(result, round, chain, deps.policy, deps.now());
      const signature = await deps.sign(result);
      // Discard a result if its block or active signer changed while signing.
      await deps.recheck(chain);
      return Response.json({ signature }, { headers });
    } catch {
      // Never echo database rows, RPC diagnostics, request bodies or credentials.
      return reply(503, "Settlement signing is unavailable.");
    }
  };
}
