import { NextResponse } from "next/server";
import { hasApifyToken, getSettingsStoreId, getRunRecord, setRunRecord } from "@/lib/apify";
import { DEFAULT_DM } from "@/lib/templates";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Each account keeps its own outreach DM template ({first} = creator's
// first name). Stored in the shared settings KV store so it follows the
// user across devices; the company copy is the default until they save.

export async function GET() {
  const user = await currentUser();
  if (!hasApifyToken()) return NextResponse.json({ template: DEFAULT_DM, isDefault: true, user });
  try {
    const storeId = await getSettingsStoreId();
    const rec = await getRunRecord(storeId, `DM_TEMPLATE_${user}`);
    return NextResponse.json({ template: rec?.template || DEFAULT_DM, isDefault: !rec?.template, user });
  } catch {
    return NextResponse.json({ template: DEFAULT_DM, isDefault: true, user });
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
  const template = String(body.template || "").trim().slice(0, 4000);
  if (!template) {
    return NextResponse.json({ error: "bad-request", message: "Template can't be empty." }, { status: 400 });
  }
  try {
    const storeId = await getSettingsStoreId();
    await setRunRecord(storeId, `DM_TEMPLATE_${user}`, { template, at: Date.now(), user });
    return NextResponse.json({ ok: true, template });
  } catch (e) {
    return NextResponse.json({ error: "settings", message: e.message }, { status: 502 });
  }
}
