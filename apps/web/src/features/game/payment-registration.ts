import { ApiRequestError } from "@/lib/api";

function wait(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 16_000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Retry registration of the SAME receipt, never approval or payment submission.
export async function registerWhenReady<T>(
  register: () => Promise<T>,
  onWaiting: () => void,
  signal: AbortSignal,
) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await register();
    } catch (error) {
      if (
        !(error instanceof ApiRequestError) ||
        error.status !== 503 ||
        error.code !== "DRAW_PENDING" ||
        attempt >= 6
      )
        throw error;
      onWaiting();
      await wait(signal);
    }
  }
}
