import { NextResponse } from "next/server";
import { fetchAllCreators } from "@/lib/notion";

export const dynamic = "force-dynamic";

const ONBOARD_STAGES = ["Approved", "Contacted", "Replied", "Interview", "Trial", "Signed"];

// Demo mode: `MOCK_PIPELINE=1 npm run dev` serves fake data for UI work
// without touching Notion.
const MOCK = {
  counts: { New: 3, Approved: 1, Contacted: 1, Replied: 1, Signed: 1 },
  queue: [
    { id: "mock-1", name: "Maya Chen", handle: "@studywithmaya", platform: "TikTok", link: "https://www.tiktok.com/@studywithmaya", followers: 24300, views: 187000, score: 88, rationale: "Strong views-to-follower ratio, consistent studytok content, English, active this week.", notes: "Posts grad school vlogs.", status: "New", lastEdited: "2026-07-01T10:00:00Z" },
    { id: "mock-2", name: "Tom Okafor", handle: "@phdtom", platform: "TikTok", link: "https://www.tiktok.com/@phdtom", followers: 8100, views: 41000, score: 81, rationale: "PhD life niche, mid-size account in the sweet spot, good engagement.", notes: null, status: "New", lastEdited: "2026-07-01T09:00:00Z" },
    { id: "mock-3", name: null, handle: "@quietlibrary", platform: "TikTok", link: "https://www.tiktok.com/@quietlibrary", followers: 3400, views: 12000, score: 74, rationale: "Study-with-me content, small but growing, no competitor promos found.", notes: null, status: "New", lastEdited: "2026-06-30T18:00:00Z" },
  ],
  roster: [
    { id: "mock-4", name: "Ana Silva", handle: "@anastudies", platform: "TikTok", link: "https://www.tiktok.com/@anastudies", followers: 15000, views: 90000, score: 85, rationale: null, notes: null, status: "Approved", lastEdited: "2026-07-01T12:00:00Z" },
    { id: "mock-5", name: "Jake Morrison", handle: "@jakelearns", platform: "TikTok", link: "https://www.tiktok.com/@jakelearns", followers: 22000, views: 130000, score: 90, rationale: null, notes: null, status: "Contacted", lastEdited: "2026-07-01T11:00:00Z" },
    { id: "mock-6", name: "Priya Patel", handle: "@priyaphd", platform: "TikTok", link: "https://www.tiktok.com/@priyaphd", followers: 31000, views: 210000, score: 92, rationale: null, notes: null, status: "Replied", lastEdited: "2026-06-30T16:00:00Z" },
    { id: "mock-7", name: "Sofia Reyes", handle: "@sofiawrites", platform: "TikTok", link: "https://www.tiktok.com/@sofiawrites", followers: 12000, views: 76000, score: 87, rationale: null, notes: null, status: "Signed", lastEdited: "2026-06-29T14:00:00Z" },
  ],
};

export async function GET() {
  if (process.env.MOCK_PIPELINE === "1") {
    return NextResponse.json(MOCK);
  }
  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json(
      { error: "setup", message: "NOTION_TOKEN is not set. Add it to .env.local and restart the dev server." },
      { status: 503 }
    );
  }
  try {
    // "Screened" rows are the AI-rejection ledger — dedupe data, not pipeline data
    const all = (await fetchAllCreators()).filter((c) => c.status !== "Screened");

    const counts = {};
    for (const c of all) {
      if (c.status) counts[c.status] = (counts[c.status] || 0) + 1;
    }

    // Already sorted by Score desc from the Notion query
    const queue = all.filter((c) => c.status === "New");

    const roster = all
      .filter((c) => ONBOARD_STAGES.includes(c.status))
      .sort((a, b) => new Date(b.lastEdited) - new Date(a.lastEdited));

    return NextResponse.json({ counts, queue, roster });
  } catch (e) {
    return NextResponse.json(
      { error: "notion", message: e.message || "Notion request failed" },
      { status: 502 }
    );
  }
}
