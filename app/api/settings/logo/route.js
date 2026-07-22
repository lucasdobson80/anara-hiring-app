import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/apify";

export const dynamic = "force-dynamic";

// Workspace logo, shared by the whole team via the settings KV store.
// Stored as a small data URL (the client downscales to 96px before upload).

export async function GET() {
  const rec = await getSetting("WORKSPACE_LOGO");
  return NextResponse.json({ logo: rec?.data || null });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  const data = body?.logo ?? null;
  if (data !== null && (typeof data !== "string" || !data.startsWith("data:image/") || data.length > 200_000)) {
    return NextResponse.json({ error: "bad-request", message: "Logo must be an image data URL under ~150KB." }, { status: 400 });
  }
  await setSetting("WORKSPACE_LOGO", { data, at: Date.now() });
  return NextResponse.json({ ok: true, logo: data });
}
