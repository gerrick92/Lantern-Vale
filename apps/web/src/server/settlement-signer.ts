import "server-only";
import {
  recoverTypedDataAddress,
  isAddressEqual,
  type Address,
  type Hex,
} from "viem";
import type { settlementResult } from "./settlement-result";
import { ApiError } from "./http";

export type PreparedResult = ReturnType<typeof settlementResult>;
export function serializeResult(prepared: PreparedResult) {
  return {
    ...prepared,
    message: {
      ...prepared.message,
      roundId: prepared.message.roundId.toString(),
      deposited: prepared.message.deposited.toString(),
      deadline: prepared.message.deadline.toString(),
    },
  };
}

export async function verifyResultSignature(
  prepared: PreparedResult,
  signature: Hex,
  expectedSigner: Address,
) {
  try {
    const address = await recoverTypedDataAddress({ ...prepared, signature });
    if (!isAddressEqual(address, expectedSigner)) throw new Error();
  } catch {
    throw new ApiError(
      503,
      "The settlement signer returned an invalid signature. No claim was issued.",
    );
  }
}

export async function signSettlement(
  prepared: PreparedResult,
  expectedSigner: Address,
) {
  const endpoint = process.env.SETTLEMENT_SIGNER_URL;
  const credential = process.env.SETTLEMENT_SIGNER_TOKEN;
  if (!endpoint || !credential)
    throw new ApiError(
      503,
      "Settlement signing is not provisioned. Your result remains saved.",
    );
  let url: URL;
  try {
    url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new ApiError(503, "The settlement signer configuration is invalid.");
  }
  let signature: Hex;
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify(serializeResult(prepared)),
    });
    if (!response.ok || !response.body) throw new Error();
    const reader = response.body.getReader();
    let total = 0,
      raw = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 2048) {
          await reader.cancel();
          throw new Error();
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(raw);
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      !/^0x[0-9a-f]{130}$/i.test(body.signature)
    )
      throw new Error();
    signature = body.signature;
  } catch {
    throw new ApiError(
      503,
      "Settlement signing is temporarily unavailable. Retry the saved result; do not pay again.",
    );
  }
  await verifyResultSignature(prepared, signature, expectedSigner);
  return signature;
}
