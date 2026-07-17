import { NextResponse } from "next/server";
import { fetchAllCreators } from "@/lib/notion";
import { currentUser, TEAM } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FUNNEL = ["Approved", "Contacted", "Replied", "Interview", "Signed"];

// Per-person signing goal by period (Day 2, Week 10, Month 40); the team
// goal is this × headcount, so it scales as accounts are added.
const GOAL_PER_PERSON = { day: 2, week: 10, month: 40 };

const iso = (d) => d.toISOString().slice(0, 10); // UTC — matches how Stage Log stamps are written

// [from, to) date-string bounds for the selected period + offset, all UTC.
function periodBounds(period, offset) {
  const now = new Date();
  if (period === "day") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
    return { from: iso(d), to: iso(new Date(d.getTime() + 86400000)) };
  }
  if (period === "month") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
    return { from: iso(from), to: iso(to) };
  }
  // week, Monday-start
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offset * 7);
  return { from: iso(d), to: iso(new Date(d.getTime() + 7 * 86400000)) };
}

const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function labelFor(period, fromISO) {
  const [y, m, dd] = fromISO.split("-").map(Number);
  if (period === "month") return `${MON_LONG[m - 1]} ${y}`;
  const wd = WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  if (period === "day") return `${wd} ${dd} ${MON_SHORT[m - 1]}`;
  return `Week of ${dd} ${MON_SHORT[m - 1]}`;
}

// Unique creators per stage whose Stage Log stamp lands in [from, to).
function periodFunnel(creators, from, to) {
  const out = {};
  for (const s of FUNNEL) out[s.toLowerCase()] = 0;
  for (const c of creators) {
    const seen = new Set();
    for (const ev of c.stageEvents || []) {
      if (ev.date >= from && ev.date < to && FUNNEL.includes(ev.status) && !seen.has(ev.status)) {
        out[ev.status.toLowerCase()] += 1;
        seen.add(ev.status);
      }
    }
  }
  return out;
}

export async function GET(request) {
  const user = await currentUser();
  const url = new URL(request.url);
  const period = ["day", "week", "month"].includes(url.searchParams.get("period")) ? url.searchParams.get("period") : "week";
  const offset = Math.max(-260, Math.min(0, parseInt(url.searchParams.get("offset"), 10) || 0));
  const scope = url.searchParams.get("scope") === "all" ? "all" : "mine";

  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json({ error: "setup", message: "NOTION_TOKEN is not set." }, { status: 503 });
  }
  try {
    let all = (await fetchAllCreators()).filter((c) => c.status !== "Screened");
    all = all.map((c) => ({ ...c, owner: c.owner || "lucas" }));
    const scoped = scope === "all" ? all : all.filter((c) => c.owner === user);

    const { from, to } = periodBounds(period, offset);
    const funnel = periodFunnel(scoped, from, to);

    // Per-account rows: every member, every stage (accountability table).
    const perOwner = {};
    for (const m of TEAM) perOwner[m] = periodFunnel(all.filter((c) => c.owner === m), from, to);

    const perPerson = GOAL_PER_PERSON[period];
    const goal = scope === "all" ? perPerson * TEAM.length : perPerson;

    return NextResponse.json({
      period, offset, scope, user, team: TEAM,
      label: labelFor(period, from), from, to, isCurrent: offset === 0,
      funnel, perOwner,
      goalPerPerson: perPerson, goal, signed: funnel.signed,
    });
  } catch (e) {
    return NextResponse.json({ error: "hq", message: e.message || "Notion request failed" }, { status: 502 });
  }
}
