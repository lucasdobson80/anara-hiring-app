import { NextResponse } from "next/server";
import { fetchAllCreators } from "@/lib/notion";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Posts the end-of-day team summary to Slack (incoming webhook). Numbers
// are always TEAM-WIDE regardless of who clicks — it's a team channel.
// Counts come from Stage Log stamps: unique creators per stage, today and
// this Monday-start week.

const iso = (d) => d.toISOString().slice(0, 10);
function mondayOf() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}

function countStage(creators, status, fromISO, toISO) {
  let n = 0;
  for (const c of creators) {
    if ((c.stageEvents || []).some((ev) => ev.status === status && ev.date >= fromISO && ev.date < toISO)) n += 1;
  }
  return n;
}

export async function POST() {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json(
      { error: "setup", message: "SLACK_WEBHOOK_URL is not set — create an incoming webhook for #ext-ugc-hiring-team and add it to the Vercel env." },
      { status: 503 }
    );
  }
  const user = await currentUser();
  try {
    const all = (await fetchAllCreators()).filter((c) => c.status !== "Screened");
    const today = iso(new Date());
    const tomorrow = iso(new Date(Date.now() + 86400000));
    const wkStart = mondayOf();

    const line = (label, status) =>
      `${label}: ${countStage(all, status, today, tomorrow)} (${countStage(all, status, wkStart, tomorrow)} this week)`;

    const text = [
      "Daily Hiring Update:",
      "",
      line("Creators Contacted", "Contacted"),
      line("Responses Received", "Replied"),
      line("Interviews Scheduled", "Interview"),
      line("Onboarded", "Signed"),
    ].join("\n");

    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Slack responded ${res.status}: ${(await res.text()).slice(0, 200)}`);

    return NextResponse.json({ ok: true, text, sentBy: user });
  } catch (e) {
    return NextResponse.json({ error: "slack", message: e.message }, { status: 502 });
  }
}
