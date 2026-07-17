import { NextResponse } from "next/server";
import { hasApifyToken, runSyncItems, aggregateCandidates, runInstagram, isIgReserved } from "@/lib/apify";
import { hasAnthropicKey, scoreCandidates } from "@/lib/scoring";
import { fetchAllCreators, createCreator, updateStatus, normHandle } from "@/lib/notion";
import { currentUser } from "@/lib/auth";

// One synchronous scrape of a handful of hand-picked profiles + scoring.
export const maxDuration = 300;

const MAX_PROFILES = 30;

// LinkedIn profiles are tracked bookmarks: no scraping (LinkedIn blocks
// it, and there are no content stats to score anyway) — the person was
// judged by eye while scrolling. Name is prettified from the URL slug.
function linkedInName(slug) {
  const words = decodeURIComponent(slug)
    .split("-")
    .filter((w) => w && !/\d/.test(w)) // drop the trailing id junk (jane-doe-1a2b3c)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  return words.length ? words.join(" ") : slug;
}

// Accepts pasted TikTok or Instagram profile links, video/reel links,
// @handles, bare handles (treated as TikTok), or LinkedIn profile links.
function parseInput(text) {
  const profiles = new Set();   // TikTok usernames
  const postURLs = new Set();   // TikTok video URLs
  const igUsernames = new Set();
  const igPostUrls = new Set();
  const liProfiles = new Set(); // LinkedIn /in/ slugs
  for (const token of String(text).split(/[\s,]+/).filter(Boolean)) {
    // --- LinkedIn ---
    const li = token.match(/linkedin\.com\/in\/([A-Za-z0-9\-_%.]+)/i);
    if (li) { liProfiles.add(li[1].replace(/\/+$/, "").toLowerCase()); continue; }
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
    liProfiles: [...liProfiles].slice(0, MAX_PROFILES),
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
  const { profiles, postURLs, igUsernames, igPostUrls, liProfiles } = parseInput(body.text || "");
  if (!profiles.length && !postURLs.length && !igUsernames.length && !igPostUrls.length && !liProfiles.length) {
    return NextResponse.json(
      { error: "bad-request", message: "No TikTok, Instagram, or LinkedIn profiles / video links recognised in the input." },
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

    // LinkedIn: tracked bookmarks — no scrape, no score, straight to Onboard
    for (const slug of liProfiles) {
      candidates.push({
        handle: slug,
        name: linkedInName(slug),
        platform: "LinkedIn",
        profileUrl: `https://www.linkedin.com/in/${slug}/`,
        followers: null,
        maxViews: null,
        email: null,
      });
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
        // Hand-picking overrides an earlier automated (or hasty) rejection —
        // straight into the pipeline as Approved, ready to DM
        await updateStatus(known.id, "Approved");
        rescued += 1;
        addedList.push(c.handle);
        details.push({ handle: c.handle, platform: plat, score: known.score, followers: known.followers ?? c.followers, email: known.email || c.email || null, rescued: true, owner: known.owner || "lucas" });
      } else {
        alreadyKnown += 1;
        details.push({ handle: c.handle, platform: plat, score: known.score, followers: known.followers, email: known.email, rescued: false, alreadyKnown: true, owner: known.owner || "lucas" });
      }
    }

    if (fresh.length) {
      // Score just for the card's context, then insert straight into the
      // pipeline as Approved — you hand-picked them while scrolling, so
      // they skip Review and land in Onboard ready to DM. LinkedIn adds
      // have no content stats to grade, so they skip scoring entirely.
      const toScore = fresh.filter((c) => c.platform !== "LinkedIn");
      let results = new Map();
      try {
        if (toScore.length) ({ results } = await scoreCandidates(toScore, 70));
      } catch {
        // scoring is best-effort here; still add the creators
      }
      for (const c of fresh) {
        const s = results.get(normHandle(c.handle));
        const rationale = c.platform === "LinkedIn"
          ? "Added from LinkedIn — no content stats to score; judged by eye while scrolling."
          : s
          ? `${s.hard_reject ? `⚠ ${s.reject_reason || "flagged"} — ` : ""}${s.rationale} (added manually)`
          : "Added manually from organic scrolling.";
        const niche = [...new Set([...(s?.niche || []), ...(c.ugcSignals?.length >= 2 || c.ugcSignals?.includes("ugc-bio") ? ["ugc"] : [])])];
        await createCreator(
          { ...c, score: s?.score ?? null, rationale, niche },
          "Approved",
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
