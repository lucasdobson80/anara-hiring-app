import { NextResponse } from "next/server";
import { hasGoogle, listEvents, createEvent } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasGoogle()) {
    return NextResponse.json(
      { error: "setup", message: "Google Calendar is not connected yet." },
      { status: 503 }
    );
  }
  try {
    const events = await listEvents();
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json({ error: "google", message: e.message }, { status: 502 });
  }
}

export async function POST(request) {
  if (!hasGoogle()) {
    return NextResponse.json({ error: "setup", message: "Google Calendar is not connected yet." }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  const { title, startISO, durationMins, description } = body;
  if (!title || !startISO) {
    return NextResponse.json({ error: "bad-request", message: "title and startISO are required." }, { status: 400 });
  }
  const duration = Math.min(Math.max(parseInt(durationMins, 10) || 30, 10), 180);
  try {
    const event = await createEvent({ title, startISO, durationMins: duration, description: description || "" });
    return NextResponse.json(event);
  } catch (e) {
    return NextResponse.json({ error: "google", message: e.message }, { status: 502 });
  }
}
