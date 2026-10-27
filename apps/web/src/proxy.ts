import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, authConfigured } from "@/lib/auth-config";
import { isDeveloperAccount } from "@/server/developer-policy";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isDeveloper = path === "/dev" || path.startsWith("/dev/");
  function developerDenied() {
    const next = new NextResponse("Not found", { status: 404 });
    response.cookies.getAll().forEach((cookie) => next.cookies.set(cookie));
    next.headers.set("Cache-Control", "private, no-store");
    return next;
  }
  if (isDeveloper && !isDeveloperAccount(process.env.DEVELOPER_USER_ID ?? ""))
    return developerDenied();
  const isGame =
    path.startsWith("/games/mosslight") &&
    ![
      "/games/mosslight/CREDITS.txt",
      "/games/mosslight/THIRD_PARTY_LICENSES.txt",
    ].includes(path);
  const isEntry =
    path.endsWith("/index.html") ||
    path === "/games/mosslight" ||
    path === "/games/mosslight/";
  function denied(status: number) {
    const next =
      isEntry && status !== 503
        ? NextResponse.redirect(
            new URL(status === 401 ? "/auth" : "/adventure", request.url),
          )
        : NextResponse.json(
            {
              error:
                status === 401
                  ? "Sign in to continue."
                  : status === 403
                    ? "Complete account verification to play."
                    : "Account service unavailable.",
            },
            { status },
          );
    response.cookies.getAll().forEach((cookie) => next.cookies.set(cookie));
    next.headers.set("Cache-Control", "private, no-store");
    return next;
  }
  if (!authConfigured)
    return isDeveloper ? developerDenied() : isGame ? denied(503) : response;
  const client = createServerClient(authConfig.url!, authConfig.key!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (updates) => {
        updates.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        updates.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (isGame || isDeveloper) {
    if (error || !user) return isDeveloper ? developerDenied() : denied(401);
    if (isDeveloper && !isDeveloperAccount(user.id)) return developerDenied();
    const claims = await client.auth.getClaims();
    if (claims.error || claims.data?.claims.sub !== user.id)
      return isDeveloper ? developerDenied() : denied(401);
    if (
      !user.email_confirmed_at ||
      claims.data.claims.aal !== "aal2" ||
      !user.factors?.some(
        (f) => f.factor_type === "totp" && f.status === "verified",
      )
    )
      return isDeveloper ? developerDenied() : denied(403);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/",
    "/features",
    "/dashboard/:path*",
    "/wallet/:path*",
    "/settings/:path*",
    "/adventure/:path*",
    "/auth/:path*",
    "/api/:path*",
    "/dev/:path*",
    "/games/mosslight/:path*",
  ],
};
