import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies.has("hrms_refresh_token");

  if (request.nextUrl.pathname === "/") {
    const canRestoreSession = request.method === "GET" || request.method === "HEAD";
    // The dashboard uses this fallback when the API rejects a saved session.
    const sessionRejected = request.nextUrl.searchParams.get("session") === "expired";
    if (canRestoreSession && hasSessionCookie && !sessionRejected) {
      const response = NextResponse.redirect(new URL("/dashboard", request.url));
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/dashboard/:path*"] };
