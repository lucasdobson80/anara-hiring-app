import { NextResponse } from "next/server";
import { appendNote } from "@/lib/notion";

export async function POST(request) {
  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json({ error: "setup", message: "NOTION_TOKEN is not set." }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  const note = String(body.note || "").trim();
  if (!body.pageId || !note) {
    return NextResponse.json({ error: "bad-request", message: "pageId and note are required." }, { status: 400 });
  }
  try {
    await appendNote(body.pageId, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "notion", message: e.message }, { status: 502 });
  }
}
