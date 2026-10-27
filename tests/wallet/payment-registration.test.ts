import { afterEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../apps/web/src/lib/api";
import { registerWhenReady } from "../../apps/web/src/features/game/payment-registration";

afterEach(() => vi.useRealTimers());
it("waits for the committed draw and retries the same registration", async () => {
  vi.useFakeTimers();
  const register = vi
    .fn()
    .mockRejectedValueOnce(new ApiRequestError("Waiting", 503, "DRAW_PENDING"))
    .mockResolvedValue({ roundId: "same-round" });
  const waiting = vi.fn();
  const result = registerWhenReady(
    register,
    waiting,
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(15999);
  expect(register).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ roundId: "same-round" });
  expect(register).toHaveBeenCalledTimes(2);
  expect(waiting).toHaveBeenCalledOnce();
});
it("does not retry authentication, receipt, transport or unrelated service failures", async () => {
  for (const error of [
    new ApiRequestError("Wrong owner", 403),
    new ApiRequestError("Bad receipt", 409),
    new ApiRequestError("Unavailable", 503),
    new Error("Network unavailable"),
  ]) {
    const register = vi.fn().mockRejectedValue(error);
    await expect(
      registerWhenReady(register, vi.fn(), new AbortController().signal),
    ).rejects.toBe(error);
    expect(register).toHaveBeenCalledOnce();
  }
});
it("bounds waiting without submitting any new payment", async () => {
  vi.useFakeTimers();
  const register = vi
    .fn()
    .mockRejectedValue(new ApiRequestError("Waiting", 503, "DRAW_PENDING"));
  const result = expect(
    registerWhenReady(register, vi.fn(), new AbortController().signal),
  ).rejects.toThrow("Waiting");
  await vi.advanceTimersByTimeAsync(96_000);
  await result;
  expect(register).toHaveBeenCalledTimes(7);
});
it("stops background registration when the game view is closed", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const register = vi
    .fn()
    .mockRejectedValue(new ApiRequestError("Waiting", 503, "DRAW_PENDING"));
  const result = expect(
    registerWhenReady(register, vi.fn(), controller.signal),
  ).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(32_000);
  await result;
  expect(register).toHaveBeenCalledOnce();
});
