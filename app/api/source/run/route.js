import { NextResponse } from "next/server";
import {
  hasApifyToken, startRun, startResearcherRun, startResearcherIgRuns, startUgcLinkedInRun,
  setRunRecord, UGC_POOL, sampleUgcTags, getSetting, setSetting, COUNTRY_CODE, isIgReserved,
} from "@/lib/apify";
import { fetchAllCreators, normHandle } from "@/lib/notion";
import { currentUser } from "@/lib/auth";

const clamp = (v, lo, hi, dflt) => Math.min(Math.max(parseInt(v, 10) || dflt, lo), hi);

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

  // ── Researcher track: LinkedIn people-search + Instagram hunt (Laia) ──
  if (body.track === "researcher") {
    const roles = (body.roles || []).map((r) => String(r).trim()).filter(Boolean).slice(0, 15);
    const countries = (body.countries || []).map((c) => String(c).trim()).filter(Boolean).slice(0, 6);
    if (!roles.length || !countries.length) {
      return NextResponse.json({ error: "bad-request", message: "Pick at least one role and one country." }, { status: 400 });
    }
    const maxItems = clamp(body.maxItems, 5, 1000, 100);
    const threshold = clamp(body.threshold, 60, 85, 70);
    const owner = await currentUser();

    // Instagram: one click fires up to three discovery runs (account search,
    // hashtag sweep, related-profiles crawl seeded from her existing IG finds)
    if (body.platform === "Instagram") {
      // Follower band applied at import time, after profile enrichment (the
      // only point where follower counts are known). Absent = wide open.
      const minFollowers = Math.max(0, Math.min(1_000_000, parseInt(body.minFollowers, 10) || 0));
      const maxFollowers = Math.max(minFollowers + 1, Math.min(10_000_000, parseInt(body.maxFollowers, 10) || 10_000_000));
      try {
        const existing = await fetchAllCreators();
        const seeds = existing
          .filter((c) => (c.track || "creator") === "researcher" && c.platform === "Instagram"
            && ["Approved", "Contacted", "Replied", "Interview", "Signed"].includes(c.status))
          .map((c) => normHandle(c.handle))
          .filter((h) => h && !isIgReserved(h))
          .slice(0, 8);
        const started = await startResearcherIgRuns({ roles, maxItems, seeds });
        for (const { mode, label, run } of started) {
          if (run.defaultKeyValueStoreId) {
            await setRunRecord(run.defaultKeyValueStoreId, "CASTING_DESK_CONFIG", {
              track: "researcher", platform: "Instagram", igMode: mode, label,
              countries, threshold, owner, minFollowers, maxFollowers,
            }).catch(() => {});
          }
        }
        return NextResponse.json({ runs: started.map(({ mode, run }) => ({ id: run.id, mode, status: run.status })) });
      } catch (e) {
        return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
      }
    }

    try {
      const run = await startResearcherRun({ roles, countries, activeRecently: Boolean(body.activeRecently), maxItems });
      if (run.defaultKeyValueStoreId) {
        await setRunRecord(run.defaultKeyValueStoreId, "CASTING_DESK_CONFIG", {
          track: "researcher", threshold, owner, roles, countries,
          cursorKey: run.cursorKey, startPage: run.startPage,
          label: `pages ${run.startPage}–${run.startPage + run.takePages - 1}`,
        }).catch(() => {});
      }
      return NextResponse.json({ id: run.id, status: run.status, startPage: run.startPage });
    } catch (e) {
      return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
    }
  }

  // ── Creator track: UGC-freelancer hunt (TikTok + LinkedIn) ──
  const countries = (body.countries || []).map((c) => String(c).trim()).filter((c) => COUNTRY_CODE[c]).slice(0, 4);
  const threshold = clamp(body.threshold, 60, 85, 70);
  const owner = await currentUser();
  if (!countries.length) {
    return NextResponse.json({ error: "bad-request", message: "Pick at least one country." }, { status: 400 });
  }
  const countryCodes = countries.map((c) => COUNTRY_CODE[c]);

  // LinkedIn UGC freelancers (job-title search, cursor-paginated for weekly re-runs)
  if (body.platform === "LinkedIn") {
    const maxItems = clamp(body.maxItems, 5, 1000, 100);
    try {
      const run = await startUgcLinkedInRun({ countries, maxItems });
      if (run.defaultKeyValueStoreId) {
        await setRunRecord(run.defaultKeyValueStoreId, "CASTING_DESK_CONFIG", {
          track: "creator", platform: "LinkedIn", countries, threshold, owner,
        }).catch(() => {});
      }
      return NextResponse.json({ id: run.id, status: run.status });
    } catch (e) {
      return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
    }
  }

  // TikTok UGC hashtag scrape. Fixed pool, sample 8 (avoiding last run's set),
  // proxy-biased to a random selected country. Follower band is dead (ugcOnly).
  // The actor caps ~100 results per hashtag, so volume scales with TAG COUNT:
  // 8 tags for small runs up to 14 for big ones (pool of 19 still rotates).
  const maxItems = clamp(body.maxItems, 10, 1400, 500);
  try {
    const last = (await getSetting("TT_UGC_LAST_TAGS")) || {};
    const tagCount = Math.min(14, Math.max(8, Math.ceil(maxItems / 100)));
    const hashtags = sampleUgcTags(last.tags || [], tagCount);
    const resultsPerPage = Math.min(100, Math.ceil(maxItems / hashtags.length));
    const proxyCountryCode = countryCodes[Math.floor(Math.random() * countryCodes.length)];
    const run = await startRun({ hashtags, resultsPerPage, days: 30, maxItems, proxyCountryCode });
    await setSetting("TT_UGC_LAST_TAGS", { tags: hashtags, at: Date.now() });
    if (run.defaultKeyValueStoreId) {
      await setRunRecord(run.defaultKeyValueStoreId, "CASTING_DESK_CONFIG", {
        track: "creator", ugcOnly: true, countries, threshold, owner, days: 30,
      }).catch(() => {});
    }
    return NextResponse.json({ id: run.id, status: run.status });
  } catch (e) {
    return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
  }
}
