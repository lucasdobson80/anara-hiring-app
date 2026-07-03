import { NextResponse } from "next/server";

// Constant-time string comparison (edge runtime has no timingSafeEqual)
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a.length || !b.length) {
    return a === b && a.length > 0;
  }
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i % ab.length] ?? 0) ^ (bb[i % bb.length] ?? 0);
  return diff === 0;
}

// Shared-password gate for the hosted deployment (HTTP Basic Auth).
// When APP_PASSWORD is unset (local dev), the app is open.
export function middleware(request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  // Browsers can attach cached Basic credentials to cross-site requests —
  // block state-changing CSRF attempts outright.
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && request.headers.get("sec-fetch-site") === "cross-site") {
    return new NextResponse("Cross-site requests are not allowed", { status: 403 });
  }

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(":");
      const user = idx === -1 ? decoded : decoded.slice(0, idx);
      const pass = idx === -1 ? "" : decoded.slice(idx + 1);
      // Accept the password in either field so "anara / <password>" or
      // just typing it as the username both work.
      if (safeEqual(user, password) || safeEqual(pass, password)) return NextResponse.next();
    } catch {
      // Malformed base64 → fall through to 401 rather than crashing to a 500
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Anara Casting Desk"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
