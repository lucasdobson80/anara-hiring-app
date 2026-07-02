import { NextResponse } from "next/server";
import { hasApifyToken, startRun } from "@/lib/apify";

export async function POST(request) {
  if (!hasApifyToken()) {
    return NextResponse.json({ error: "setup", message: "APIFY_TOKEN is not set." }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  const hashtags = (body.hashtags || []).map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean);
  const resultsPerPage = Math.min(Math.max(parseInt(body.resultsPerPage, 10) || 60, 1), 200);
  const days = Math.min(Math.max(parseInt(body.days, 10) || 30, 1), 365);
  const maxItems = Math.min(Math.max(parseInt(body.maxItems, 10) || 500, 10), 1500);
  if (!hashtags.length) {
    return NextResponse.json({ error: "bad-request", message: "At least one hashtag is required." }, { status: 400 });
  }
  try {
    const run = await startRun({ hashtags, resultsPerPage, days, maxItems });
    return NextResponse.json({ id: run.id, status: run.status });
  } catch (e) {
    return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
  }
}
