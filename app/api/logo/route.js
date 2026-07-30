import { NextResponse } from "next/server";
import { getSetting } from "@/lib/apify";

export const dynamic = "force-dynamic";

// PUBLIC, read-only: the workspace logo for unauthenticated pages (/apply).
// Uploading/changing the logo stays behind auth at /api/settings/logo.
export async function GET() {
  const rec = await getSetting("WORKSPACE_LOGO");
  return NextResponse.json({ logo: rec?.data || null });
}
