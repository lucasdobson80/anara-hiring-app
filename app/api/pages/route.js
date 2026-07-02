import { NextResponse } from "next/server";
import { updateStatus } from "@/lib/notion";

const STAGES = ["New", "Approved", "Rejected", "Contacted", "Replied", "Interview", "Trial", "Signed"];

export async function PATCH(request) {
  if (process.env.MOCK_PIPELINE === "1") {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ updated: (body?.updates || []).length, failed: [] });
  }
  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json({ error: "setup", message: "NOTION_TOKEN is not set." }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  const updates = Array.isArray(body?.updates) ? body.updates : [];
  if (!updates.length) {
    return NextResponse.json({ error: "bad-request", message: "No updates provided." }, { status: 400 });
  }
  for (const u of updates) {
    if (!u?.id || !STAGES.includes(u?.status)) {
      return NextResponse.json(
        { error: "bad-request", message: "Each update needs an id and a valid status." },
        { status: 400 }
      );
    }
  }

  // Notion has no batch endpoint (~3 req/s limit) — update sequentially and
  // report per-page failures so unsaved decisions can stay queued client-side.
  const failed = [];
  let updated = 0;
  for (const u of updates) {
    try {
      await updateStatus(u.id, u.status);
      updated += 1;
    } catch (e) {
      failed.push({ id: u.id, message: e.message || "update failed" });
    }
  }
  return NextResponse.json({ updated, failed });
}
