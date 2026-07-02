import { NextResponse } from "next/server";
import { hasAnthropicKey, parseBrief } from "@/lib/scoring";

export async function POST(request) {
  if (!hasAnthropicKey()) {
    return NextResponse.json({ error: "setup", message: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  const brief = String(body.brief || "").trim();
  if (!brief) {
    return NextResponse.json({ error: "bad-request", message: "Empty brief." }, { status: 400 });
  }
  try {
    const config = await parseBrief(brief);
    return NextResponse.json(config);
  } catch (e) {
    return NextResponse.json({ error: "parse", message: e.message }, { status: 502 });
  }
}
