import { NextResponse } from "next/server";
import { hasApifyToken, runSyncItems, aggregateCandidates, runInstagram, isIgReserved } from "@/lib/apify";
import { fetchAllCreators, createCreator, updateStatus, normHandle } from "@/lib/notion";
import { currentUser } from "@/lib/auth";

// Hand-picked adds insert instantly (no scrape, no scoring); only pasted
// video/reel links hit Apify, purely to resolve which creator posted them.
export const maxDuration = 120;

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

  // Video/reel links are the only inputs that need Apify (to resolve which
  // creator posted them) — profile links and handles insert instantly, free.
  if ((postURLs.length || igPostUrls.length) && !hasApifyToken()) {
    return NextResponse.json({ error: "setup", message: "APIFY_TOKEN is needed to resolve video links — paste profile links or @handles instead." }, { status: 503 });
  }

  const owner = await currentUser();
  const track = ["researcher", "partner"].includes(body.track) ? body.track : "creator";
  try {
    const candidates = [];

    // TikTok profiles: hand-picked while scrolling — no scrape, no score.
    // The human already judged them; speed beats stats here.
    for (const handle of profiles) {
      candidates.push({
        handle,
        name: handle,
        platform: "TikTok",
        profileUrl: `https://www.tiktok.com/@${handle}`,
        followers: null,
        maxViews: null,
        email: null,
      });
    }

    // Instagram profiles: same instant treatment
    for (const u of igUsernames) {
      candidates.push({
        handle: u,
        name: u,
        platform: "Instagram",
        profileUrl: `https://www.instagram.com/${u}/`,
        followers: null,
        maxViews: null,
        email: null,
      });
    }

    // TikTok video links: minimal scrape purely to resolve the creator
    if (postURLs.length) {
      const items = await runSyncItems(
        { postURLs, shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false },
        { maxItems: postURLs.length }
      );
      const { candidates: tk } = aggregateCandidates(items, { days: 3650, lenient: true });
      candidates.push(...tk.map((c) => ({ ...c, platform: "TikTok" })));
    }

    // Instagram reel/post links: same — resolve the owner, nothing more
    if (igPostUrls.length) {
      const ig = await runInstagram({ usernames: [], postUrls: igPostUrls });
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
      // No scoring — hand-picked creators were judged by eye, and skipping
      // the AI call makes adds instant and free.
      for (const c of fresh) {
        const niche = c.ugcSignals?.length >= 2 || c.ugcSignals?.includes("ugc-bio") ? ["ugc"] : [];
        await createCreator(
          { ...c, score: null, rationale: "Hand-picked from organic scrolling — judged by eye.", niche },
          "Approved",
          owner,
          track
        );
        added += 1;
        addedList.push(c.handle);
        details.push({ handle: c.handle, platform: c.platform || "TikTok", score: null, followers: c.followers, email: c.email || null, rescued: false, owner });
      }
    }

    // Video links the resolve-scrape couldn't attribute come back empty; the
    // direct profile inserts are always "found".
    const found = new Set(candidates.map((c) => normHandle(c.handle)));
    const notFound = [...profiles, ...igUsernames].filter((p) => !found.has(p));

    return NextResponse.json({ added, rescued, alreadyKnown, notFound, addedList, details });
  } catch (e) {
    return NextResponse.json({ error: "manual", message: e.message }, { status: 502 });
  }
}
