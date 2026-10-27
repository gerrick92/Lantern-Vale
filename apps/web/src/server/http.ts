import { z } from "zod";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export function appOrigin() {
  // A staged review uses its exact host supplied by Vercel, never a request
  // header or a wildcard. Public releases still configure APP_ORIGIN explicitly.
  const reviewHost = process.env.VERCEL_URL;
  const reviewOrigin =
    process.env.VERCEL === "1" &&
    process.env.LANTERN_STAGED_REVIEW === "true" &&
    reviewHost &&
    /^[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(reviewHost)
      ? `https://${reviewHost}`
      : undefined;
  const origin =
    process.env.APP_ORIGIN ||
    reviewOrigin ||
    (process.env.NODE_ENV !== "production"
      ? "http://127.0.0.1:3000"
      : undefined);
  if (!origin)
    throw new ApiError(503, "The application origin is not configured.");
  return new URL(origin).origin;
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== appOrigin())
    throw new ApiError(403, "This request must come from the application.");
}
export async function readBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "Send a JSON request.");
  const reader = request.body?.getReader();
  let bytes = "";
  let size = 0;
  const decoder = new TextDecoder();
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16_384) {
          await reader.cancel();
          throw new ApiError(413, "Request is too large.");
        }
        bytes += decoder.decode(chunk.value, { stream: true });
      }
      bytes += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return schema.parse(JSON.parse(bytes));
  } catch {
    throw new ApiError(400, "Check the submitted fields and try again.");
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function endpoint(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    return json(
      {
        ...(error instanceof ApiError && error.code
          ? { code: error.code }
          : {}),
        error:
          error instanceof ApiError
            ? error.message
            : "The request could not be completed. Please retry.",
      },
      error instanceof ApiError ? error.status : 500,
    );
  }
}
