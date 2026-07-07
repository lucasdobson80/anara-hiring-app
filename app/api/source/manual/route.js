import { NextResponse } from "next/server";
import { hasApifyToken, runSyncItems, aggregateCandidates, runInstagram, isIgReserved } from "@/lib/apify";
import { hasAnthropicKey, scoreCandidates } from "@/lib/scoring";
import { fetchAllCreators, createCreator, updateStatus, normHandle } from "@/lib/notion";
import { currentUser } from "@/lib/auth";

// One synchronous scrape of a handful of hand-picked profiles + scoring.
export const maxDuration = 300;

const MAX_PROFILES = 30;

// Accepts pasted TikTok or Instagram profile links, video/reel links,
// @handles, or bare handles (bare handles are treated as TikTok).
function parseInput(text) {
  const profiles = new Set();   // TikTok usernames
  const postURLs = new Set();   // TikTok video URLs
  const igUsernames = new Set();
  const igPostUrls = new Set();
  for (const token of String(text).split(/[\s,]+/).filter(Boolean)) {
    // --- Instagram ---
    if (/instagram\.com\/(?:reel|reels|p|tv)\//i.test(token)) { igPostUrls.add(token.split("?")[0]); continue; }
    const ig = token.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
    if (ig) { if (!isIgReserved(ig[1])) igUsernames.add(ig[1].toLowerCase()); continue; }
    // --- TikTok ---
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
    igUsernames: [...igUsernames].slice(0, MAX_PROFILES),
    igPostUrls: [...igPostUrls].slice(0, MAX_PROFILES),
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
  const { profiles, postURLs, igUsernames, igPostUrls } = parseInput(body.text || "");
  if (!profiles.length && !postURLs.length && !igUsernames.length && !igPostUrls.length) {
    return NextResponse.json(
      { error: "bad-request", message: "No TikTok or Instagram profiles / video links recognised in the input." },
      { status: 400 }
    );
  }

  const owner = await currentUser();
  try {
    const candidates = [];

    // TikTok
    if (profiles.length || postURLs.length) {
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
      // Reservation on pay-per-result actors = maxItems × price: size it to
      // what was actually pasted so small adds work even on tight plans.
      const items = await runSyncItems(input, { maxItems: (profiles.length + postURLs.length) * 6 });
      // Manual picks bypass the mechanical filters — the human chose them
      const { candidates: tk } = aggregateCandidates(items, { days: 3650, lenient: true });
      candidates.push(...tk.map((c) => ({ ...c, platform: "TikTok" })));
    }

    // Instagram (profile + reel/post links)
    if (igUsernames.length || igPostUrls.length) {
      const ig = await runInstagram({ usernames: igUsernames, postUrls: igPostUrls });
      candidates.push(...ig);
    }

    const existing = await fetchAllCreators();
    // Platform-aware key: the same @handle can be different people on TikTok
    // vs Instagram, so dedupe must not collapse them.
    const key = (h, plat) => `${(plat || "TikTok").toLowerCase()}:${normHandle(h)}`;
    const byHandle = new Map(existing.map((c) => [key(c.handle, c.platform), c]));

    let added = 0, rescued = 0, alreadyKnown = 0;
    const addedList = [];
    const details = [];
    const fresh = [];
    for (const c of candidates) {
      const plat = c.platform || "TikTok";
      const known = byHandle.get(key(c.handle, plat));
      if (!known) { fresh.push(c); continue; }
      if (known.status === "Screened" || known.status === "Rejected") {
        // Hand-picking overrides an earlier automated (or hasty) rejection
        await updateStatus(known.id, "New");
        rescued += 1;
        addedList.push(c.handle);
        details.push({ handle: c.handle, platform: plat, score: known.score, followers: known.followers ?? c.followers, email: known.email || c.email || null, rescued: true, owner: known.owner || "lucas" });
      } else {
        alreadyKnown += 1;
        details.push({ handle: c.handle, platform: plat, score: known.score, followers: known.followers, email: known.email, rescued: false, alreadyKnown: true, owner: known.owner || "lucas" });
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
          "New",
          owner
        );
        added += 1;
        addedList.push(c.handle);
        details.push({ handle: c.handle, platform: c.platform || "TikTok", score: s?.score ?? null, followers: c.followers, email: c.email || null, rescued: false, owner });
      }
    }

    // Profiles the scrape couldn't resolve (typo, private, deleted)
    const found = new Set(candidates.map((c) => normHandle(c.handle)));
    const notFound = [...profiles, ...igUsernames].filter((p) => !found.has(p));

    return NextResponse.json({ added, rescued, alreadyKnown, notFound, addedList, details });
  } catch (e) {
    return NextResponse.json({ error: "manual", message: e.message }, { status: 502 });
  }
}
