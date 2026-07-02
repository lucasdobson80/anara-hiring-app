import { NextResponse } from "next/server";

// Shared-password gate for the hosted deployment (HTTP Basic Auth).
// When APP_PASSWORD is unset (local dev), the app is open.
export function middleware(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice(6));
    // Accept the password in either field so "anara / <password>" or
    // just typing it as the username both work.
    const [user, pass] = decoded.split(":");
    if (user === password || pass === password) return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Anara Casting Desk"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
