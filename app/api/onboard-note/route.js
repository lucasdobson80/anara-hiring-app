import { NextResponse } from "next/server";
import { appendNote } from "@/lib/notion";

export const dynamic = "force-dynamic";

// Stamps a whitelisted milestone note onto a creator's Notion page:
// "onboarded" when the signing wizard completes, "bump" when a
// follow-up bump is sent (feeds the needs-a-bump queue).
const NOTES = {
  onboarded: "onboarding completed",
  "onboarded-undergrad": "onboarding completed · undergrad team",
  "onboarded-postgrad": "onboarding completed · postgrad team",
  bump: "follow-up bump sent",
};

export async function POST(request) {
  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json({ error: "setup", message: "NOTION_TOKEN is not set." }, { status: 503 });
  }
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.pageId) {
    return NextResponse.json({ error: "bad-request", message: "pageId is required." }, { status: 400 });
  }
  const note = NOTES[body.kind || "onboarded"];
  if (!note) {
    return NextResponse.json({ error: "bad-request", message: "Unknown note kind." }, { status: 400 });
  }
  try {
    await appendNote(body.pageId, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "notion", message: e.message }, { status: 502 });
  }
}
