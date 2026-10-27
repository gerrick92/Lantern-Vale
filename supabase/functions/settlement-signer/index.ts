import { configuredHandler } from "./runtime.ts";

// Configuration is validated inside the guarded path. Provider diagnostics must
// never receive key values or raw upstream responses, even on cold-start errors.
Deno.serve(async (request: Request) => {
  try {
    return await configuredHandler((name) => Deno.env.get(name))(request);
  } catch {
    return Response.json(
      { error: "Signing is unavailable." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
});
