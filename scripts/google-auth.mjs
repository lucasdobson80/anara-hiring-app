// One-time Google OAuth flow: prints the GOOGLE_REFRESH_TOKEN for .env.local.
//
// Usage:
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-auth.mjs
//
// Requires an OAuth client of type "Desktop app" in Google Cloud Console with
// the Google Calendar API enabled.

import http from "node:http";
import { exec } from "node:child_process";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 8765;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars first.");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth" +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  "&response_type=code" +
  `&scope=${encodeURIComponent(SCOPE)}` +
  "&access_type=offline&prompt=consent";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  if (!code) {
    res.end("No code in request.");
    return;
  }
  res.end("Authorized! You can close this tab and go back to the terminal.");
  server.close();
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const data = await tokenRes.json();
  if (!data.refresh_token) {
    console.error("No refresh token returned:", JSON.stringify(data));
    process.exit(1);
  }
  console.log("\nGOOGLE_REFRESH_TOKEN=" + data.refresh_token + "\n");
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("Opening Google sign-in… If the browser doesn't open, visit:\n\n" + authUrl + "\n");
  exec(`open "${authUrl}"`);
});
