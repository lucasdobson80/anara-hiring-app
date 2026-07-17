import { NextResponse } from "next/server";
import { appendNote } from "@/lib/notion";

export const dynamic = "force-dynamic";

// Stamps "onboarding completed" onto a creator's Notion page when the
// signing wizard's final step is marked done.
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
  try {
    await appendNote(body.pageId, "onboarding completed");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "notion", message: e.message }, { status: 502 });
  }
}
