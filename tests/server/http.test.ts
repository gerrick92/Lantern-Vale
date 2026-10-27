import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ApiError,
  appOrigin,
  checkOrigin,
  endpoint,
  readBody,
} from "../../apps/web/src/server/http";

afterEach(() => vi.unstubAllEnvs());

it("binds a protected review to its exact Vercel deployment hostname", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("LANTERN_STAGED_REVIEW", "true");
  vi.stubEnv("VERCEL_URL", "lantern-vale-review.vercel.app");
  expect(appOrigin()).toBe("https://lantern-vale-review.vercel.app");
  expect(() =>
    checkOrigin(
      new Request("https://irrelevant.invalid", {
        headers: { origin: "https://another-preview.vercel.app" },
      }),
    ),
  ).toThrow("must come from the application");
  vi.stubEnv("VERCEL_URL", "lantern-vale.vercel.app.attacker.invalid");
  expect(() => appOrigin()).toThrow("origin is not configured");
  vi.stubEnv("VERCEL_URL", "lantern-vale-review.vercel.app");
  vi.stubEnv("LANTERN_STAGED_REVIEW", "false");
  expect(() => appOrigin()).toThrow("origin is not configured");
  vi.stubEnv("APP_ORIGIN", "https://lantern-vale.vercel.app");
  expect(appOrigin()).toBe("https://lantern-vale.vercel.app");
});

it("returns a specific retry code without exposing unexpected error details", async () => {
  const pending = await endpoint(async () => {
    throw new ApiError(503, "Waiting for the draw", "DRAW_PENDING");
  });
  expect(pending.status).toBe(503);
  expect(await pending.json()).toEqual({
    error: "Waiting for the draw",
    code: "DRAW_PENDING",
  });
  const failure = await endpoint(async () => {
    throw new Error("private diagnostic");
  });
  expect(await failure.json()).toEqual({
    error: "The request could not be completed. Please retry.",
  });
});

it("limits streamed JSON by bytes before reading an unbounded body", async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(8193));
    },
    cancel() {
      canceled = true;
    },
  });
  const request = new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await expect(readBody(request, z.unknown())).rejects.toMatchObject({
    status: 413,
  });
  expect(canceled).toBe(true);
});

it("preserves UTF-8 characters split across stream chunks", async () => {
  const data = new TextEncoder().encode('{"name":"Lantern 🌿"}');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of data) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const request = new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await expect(
    readBody(request, z.object({ name: z.string() })),
  ).resolves.toEqual({ name: "Lantern 🌿" });
});
