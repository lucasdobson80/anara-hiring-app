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

// Named users from APP_USERS (e.g. "laia:pw1, alba:pw2"). APP_PASSWORD stays a
// universal fallback that logs in as "lucas" (preserves the original bookmark).
function parseUsers() {
  const map = new Map();
  for (const pair of String(process.env.APP_USERS || "").split(/[,\n]+/)) {
    const i = pair.indexOf(":");
    if (i > 0) {
      const u = pair.slice(0, i).trim().toLowerCase();
      const p = pair.slice(i + 1).trim();
      if (u && p) map.set(u, p);
    }
  }
  return map;
}

// Forward the resolved username to server routes; overwrite any client-sent
// value so it can't be spoofed.
function withUser(request, user) {
  const h = new Headers(request.headers);
  h.set("x-cd-user", user);
  return { request: { headers: h } };
}

export function middleware(request) {
  const password = process.env.APP_PASSWORD;
  const users = parseUsers();

  // No auth configured (local dev): open, act as lucas.
  if (!password && users.size === 0) {
    return NextResponse.next(withUser(request, "lucas"));
  }

  // Block cross-site state changes (browsers auto-attach cached Basic creds).
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && request.headers.get("sec-fetch-site") === "cross-site") {
    return new NextResponse("Cross-site requests are not allowed", { status: 403 });
  }

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(":");
      const user = (idx === -1 ? decoded : decoded.slice(0, idx)).toLowerCase();
      const pass = idx === -1 ? "" : decoded.slice(idx + 1);

      // 1) Named user with a matching password
      const expected = users.get(user);
      if (expected && safeEqual(pass, expected)) {
        return NextResponse.next(withUser(request, user));
      }
      // 2) Universal APP_PASSWORD fallback → lucas (either field, legacy)
      if (password && (safeEqual(pass, password) || safeEqual(user, password))) {
        return NextResponse.next(withUser(request, "lucas"));
      }
    } catch {
      // Malformed base64 → fall through to 401 rather than crashing to a 500
    }
  }

  // API calls get a JSON 401 so client fetches can show a real message —
  // iOS PWAs silently drop Basic-Auth sessions after backgrounding, and a
  // plain-text body makes Safari's res.json() throw the cryptic "string did
  // not match the expected pattern". Page loads keep the plain response so
  // the browser's login prompt still appears.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "auth", message: "Signed out — close and reopen the app to sign back in." },
      { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Anara Casting Desk"' } }
    );
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Anara Casting Desk"' },
  });
}

export const config = {
  // Icons + manifest stay public: iOS fetches them outside the authenticated
  // session when installing to the home screen. They contain nothing private.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-192.png|icon-512.png|apple-touch-icon.png|icon.svg).*)"],
};
