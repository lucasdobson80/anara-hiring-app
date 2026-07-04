import { NextResponse } from "next/server";
import { hasApifyToken, runSyncItems, aggregateCandidates } from "@/lib/apify";
import { hasAnthropicKey, scoreCandidates } from "@/lib/scoring";
import { fetchAllCreators, createCreator, updateStatus, normHandle } from "@/lib/notion";

// One synchronous scrape of a handful of hand-picked profiles + scoring.
export const maxDuration = 300;

const MAX_PROFILES = 30;

// Accepts pasted profile links, video links, @handles, or bare handles.
function parseInput(text) {
  const profiles = new Set();
  const postURLs = new Set();
  for (const token of String(text).split(/[\s,]+/).filter(Boolean)) {
    if (/^https?:\/\//i.test(token) && /vm\.tiktok\.com|\/video\/|\/t\//i.test(token)) {
      postURLs.add(token);
      continue;
    }
    const url = token.match(/tiktok\.com\/@([A-Za-z0-9_.\-]+)/i);
    if (url) { profiles.add(url[1].toLowerCase()); continue; }
    const at = token.match(/^@([A-Za-z0-9_.]+)$/);
    if (at) { profiles.add(at[1].toLowerCase()); continue; }
    if (/^[A-Za-z0-9_.]{2,24}$/.test(token)) profiles.add(token.toLowerCase());
  }
  return {
    profiles: [...profiles].slice(0, MAX_PROFILES),
    postURLs: [...postURLs].slice(0, MAX_PROFILES),
  };
}

export async function POST(request) {
  if (!hasApifyToken()) {
    return NextResponse.json({ error: "setup", message: "APIFY_TOKEN is not set." }, { status: 503 });
  }
  if (!hasAnthropicKey()) {
    return NextResponse.json({ error: "setup", message: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  const { profiles, postURLs } = parseInput(body.text || "");
  if (!profiles.length && !postURLs.length) {
    return NextResponse.json(
      { error: "bad-request", message: "No TikTok profiles or video links recognised in the input." },
      { status: 400 }
    );
  }

  try {
    const input = {
      resultsPerPage: 6,
      profileSorting: "latest",
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
    };
    if (profiles.length) {
      input.profiles = profiles;
      input.profileScrapeSections = ["videos"];
    }
    if (postURLs.length) input.postURLs = postURLs;

    const items = await runSyncItems(input, { maxItems: MAX_PROFILES * 6 });
    // Manual picks bypass the mechanical filters — the human chose them
    const { candidates } = aggregateCandidates(items, { days: 3650, lenient: true });

    const existing = await fetchAllCreators();
    const byHandle = new Map(existing.map((c) => [normHandle(c.handle), c]));

    let added = 0, rescued = 0, alreadyKnown = 0;
    const addedList = [];
    const fresh = [];
    for (const c of candidates) {
      const known = byHandle.get(normHandle(c.handle));
      if (!known) { fresh.push(c); continue; }
      if (known.status === "Screened" || known.status === "Rejected") {
        // Hand-picking overrides an earlier automated (or hasty) rejection
        await updateStatus(known.id, "New");
        rescued += 1;
        addedList.push(c.handle);
      } else {
        alreadyKnown += 1;
      }
    }

    if (fresh.length) {
      // Score for the review card, but insert regardless of the bar —
      // manual picks always reach human review.
      let results = new Map();
      try {
        ({ results } = await scoreCandidates(fresh, 70));
      } catch {
        // scoring is best-effort here; still add the creators
      }
      for (const c of fresh) {
        const s = results.get(normHandle(c.handle));
        const rationale = s
          ? `${s.hard_reject ? `⚠ ${s.reject_reason || "flagged"} — ` : ""}${s.rationale} (added manually)`
          : "Added manually from organic scrolling.";
        await createCreator(
          { ...c, score: s?.score ?? null, rationale, niche: s?.niche || [] },
          "New"
        );
        added += 1;
        addedList.push(c.handle);
      }
    }

    // Profiles the scrape couldn't resolve (typo, private, deleted)
    const found = new Set(candidates.map((c) => normHandle(c.handle)));
    const notFound = profiles.filter((p) => !found.has(p));

    return NextResponse.json({ added, rescued, alreadyKnown, notFound, addedList });
  } catch (e) {
    return NextResponse.json({ error: "manual", message: e.message }, { status: 502 });
  }
}
