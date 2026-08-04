import { NextResponse } from "next/server";
import { hasApifyToken, getSettingsStoreId, getRunRecord, setRunRecord } from "@/lib/apify";
import { DEFAULT_MESSAGES } from "@/lib/templates";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Each account keeps its own message bank — a named set of outreach/onboarding
// snippets ({first} = creator's first name). Stored in the shared settings KV
// store so it follows the user across devices; the company copy is the default
// until they edit. Merges over DEFAULT_MESSAGES so defaults always exist.

export async function GET() {
  const user = await currentUser();
  if (!hasApifyToken()) return NextResponse.json({ messages: DEFAULT_MESSAGES, user });
  try {
    const storeId = await getSettingsStoreId();
    const rec = await getRunRecord(storeId, `MESSAGES_${user}`).catch(() => null);
    let stored = rec?.messages || null;
    if (!stored) {
      // One-time migration of the old single DM template into the bank
      const legacy = await getRunRecord(storeId, `DM_TEMPLATE_${user}`).catch(() => null);
      stored = legacy?.template ? { "Outreach DM": legacy.template } : {};
    }
    // Migration (31 Jul 2026): the pre-split messages were the POSTGRAD set —
    // carry customized content under the new explicit names.
    if (stored["Welcome email"] && !stored["Welcome email (postgrad)"]) {
      stored["Welcome email (postgrad)"] = stored["Welcome email"];
    }
    if (stored["Trial videos link"] && !stored["Trial videos link (postgrad)"]) {
      stored["Trial videos link (postgrad)"] = stored["Trial videos link"];
    }
    return NextResponse.json({ messages: { ...DEFAULT_MESSAGES, ...stored }, user });
  } catch {
    // Store unreachable (e.g. Apify billing lock): serve defaults but SAY SO,
    // so the client can block saves — otherwise a save would overwrite the
    // user's stored bank with defaults.
    return NextResponse.json({ messages: DEFAULT_MESSAGES, user, degraded: true });
  }
}

export async function POST(request) {
  const user = await currentUser();
  if (!hasApifyToken()) {
    return NextResponse.json({ error: "setup", message: "APIFY_TOKEN is not set." }, { status: 503 });
  }
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.messages || typeof body.messages !== "object") {
    return NextResponse.json({ error: "bad-request", message: "messages object required." }, { status: 400 });
  }
  const clean = {};
  for (const [k, v] of Object.entries(body.messages)) {
    const name = String(k).trim().slice(0, 60);
    if (name) clean[name] = String(v || "").slice(0, 6000);
  }
  try {
    const storeId = await getSettingsStoreId();
    await setRunRecord(storeId, `MESSAGES_${user}`, { messages: clean, at: Date.now(), user });
    return NextResponse.json({ ok: true, messages: { ...DEFAULT_MESSAGES, ...clean } });
  } catch (e) {
    return NextResponse.json({ error: "settings", message: e.message }, { status: 502 });
  }
}
