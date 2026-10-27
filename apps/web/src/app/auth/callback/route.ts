import { NextResponse } from "next/server";
import { sessionClient } from "@/server/auth";
import { appOrigin } from "@/server/http";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.has("error")) {
    const reason =
      params.get("error") === "access_denied"
        ? "sign-in-cancelled"
        : "sign-in-failed";
    return NextResponse.redirect(`${appOrigin()}/auth?error=${reason}`);
  }
  const code = params.get("code");
  if (code && code.length <= 2048) {
    try {
      const client = await sessionClient();
      const result = await client.auth.exchangeCodeForSession(code);
      if (!result.error) {
        const recovery =
          "redirectType" in result.data &&
          result.data.redirectType === "recovery";
        return NextResponse.redirect(
          `${appOrigin()}${recovery ? "/settings" : "/dashboard"}`,
        );
      }
    } catch {
      /* Invalid or expired links return to account access. */
    }
  }
  return NextResponse.redirect(`${appOrigin()}/auth?error=expired-link`);
}
