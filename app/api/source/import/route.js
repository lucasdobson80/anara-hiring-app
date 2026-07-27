import { NextResponse } from "next/server";
import {
  hasApifyToken, getRun, getDatasetItems, aggregateCandidates, aggregateResearchers,
  aggregateUgcLinkedIn, igUsernamesFromItems, runInstagram, getRunRecord, setRunRecord,
  setSetting, COUNTRY_CODE,
} from "@/lib/apify";
import { hasAnthropicKey, scoreCandidates } from "@/lib/scoring";
import { fetchAllCreators, createCreator, handleExists, normHandle } from "@/lib/notion";
import { currentUser } from "@/lib/auth";

const COUNTRY_LABEL = { US: "US", GB: "UK", CA: "Canada", AU: "Australia" };

// Scoring + sequential Notion inserts take minutes — use the full window,
// and cap the per-invocation batch so we never hit the ceiling mid-write.
export const maxDuration = 300;

// Sized so one invocation always finishes inside Vercel's 300s window:
// 200 blew past it on big UGC-hunt runs (function killed mid-import, no
// summary written) — the client loops passes until nothing remains.
const BATCH_CAP = 60; // fresh creators processed per invocation
const CHUNK = 20; // candidates per scoring call
const LOCK_KEY = "CASTING_DESK_LOCK";
const RESULT_KEY = "CASTING_DESK_IMPORT";
const CONFIG_KEY = "CASTING_DESK_CONFIG";
const LOCK_TTL_MS = 8 * 60_000;

const addNums = (a = 0, b = 0) => (a || 0) + (b || 0);
function mergeSummaries(prev, cur) {
  if (!prev) return cur;
  return {
    ...cur,
    scored: addNums(prev.scored, cur.scored),
    hardRejected: addNums(prev.hardRejected, cur.hardRejected),
    belowThreshold: addNums(prev.belowThreshold, cur.belowThreshold),
    inserted: addNums(prev.inserted, cur.inserted),
    screened: addNums(prev.screened, cur.screened),
    unscored: addNums(prev.unscored, cur.unscored),
    // externals seen by the first pass are the true "already known" count;
    // later passes would double-count our own inserts
    alreadyKnown: prev.alreadyKnown ?? cur.alreadyKnown,
    insertFailures: [...(prev.insertFailures || []), ...(cur.insertFailures || [])].slice(0, 20),
    topMisses: [...(prev.topMisses || []), ...(cur.topMisses || [])]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
  };
}

export async function POST(request) {
  if (!hasApifyToken()) {
    return NextResponse.json({ error: "setup", message: "APIFY_TOKEN is not set." }, { status: 503 });
  }
  if (!hasAnthropicKey()) {
    return NextResponse.json({ error: "setup", message: "ANTHROPIC_API_KEY is not set — needed for scoring." }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.runId) {
    return NextResponse.json({ error: "bad-request", message: "runId is required." }, { status: 400 });
  }

  const owner = await currentUser();
  let kvId = null;
  let lockTaken = false;
  try {
    const run = await getRun(body.runId);
    if (run.status !== "SUCCEEDED") {
      return NextResponse.json(
        { error: "run-state", message: `Run is ${run.status}; import only finished runs.` },
        { status: 409 }
      );
    }
    kvId = run.defaultKeyValueStoreId;

    // Idempotency: a completed import returns its stored summary instead of
    // re-running (force=true overrides, e.g. after a scoring-rubric change).
    const prior = await getRunRecord(kvId, RESULT_KEY);
    if (prior?.done && !body.force) {
      return NextResponse.json({ ...prior.summary, remaining: 0, alreadyImported: true });
    }

    // Concurrency lock: one import per run at a time, across all devices.
    const lock = await getRunRecord(kvId, LOCK_KEY);
    if (lock?.at && Date.now() - lock.at < LOCK_TTL_MS) {
      return NextResponse.json(
        { error: "locked", message: "An import for this run is already in progress — wait for it to finish." },
        { status: 409 }
      );
    }
    await setRunRecord(kvId, LOCK_KEY, { at: Date.now() });
    lockTaken = true;

    // Settings travel with the run (written at launch); body values are a
    // fallback for runs launched before this existed or outside the app.
    const config = (await getRunRecord(kvId, CONFIG_KEY).catch(() => null)) || {};
    const track = config.track === "researcher" ? "researcher" : "creator";
    const isUgcLinkedIn = track === "creator" && config.platform === "LinkedIn";
    const isIgResearcher = track === "researcher" && config.platform === "Instagram";
    const days = config.days || body.days || 30;
    const minFollowers = config.minFollowers ?? 1000;
    const maxFollowers = config.maxFollowers ?? 150000;
    const ugcOnly = Boolean(config.ugcOnly);
    const threshold = Math.min(Math.max(config.threshold || body.threshold || 70, 60), 85);
    const platform = isIgResearcher ? "Instagram" : track === "researcher" || isUgcLinkedIn ? "LinkedIn" : "TikTok";
    const countries = config.countries || [];
    const countryCodes = countries.map((c) => COUNTRY_CODE[c]).filter(Boolean);

    const items = await getDatasetItems(run.defaultDatasetId);
    let candidates, filtered, uniqueCreators;
    if (isIgResearcher) {
      // Discovery runs only carry usernames — profiles are enriched below,
      // AFTER the dedupe, so we never pay to re-scrape known people.
      const usernames = igUsernamesFromItems(items, config.igMode);
      candidates = usernames.map((u) => ({ handle: u }));
      filtered = {};
      uniqueCreators = usernames.length;
    } else if (track === "researcher") {
      const r = aggregateResearchers(items);
      ({ candidates, filtered } = r); uniqueCreators = r.uniqueProfiles;
      // Combo walked to the end → loop its pagination cursor back to page 1
      if (items.length === 0 && config.cursorKey) await setSetting(config.cursorKey, { startPage: 1, at: Date.now() });
    } else if (isUgcLinkedIn) {
      const r = aggregateUgcLinkedIn(items, countryCodes);
      ({ candidates, filtered } = r); uniqueCreators = r.uniqueProfiles;
      // Pool walked to the end → loop the pagination cursor back to page 1
      if (items.length === 0) await setSetting("LI_UGC_CURSOR", { startPage: 1, at: Date.now() });
    } else {
      // UGC-only creator runs kill the follower band; legacy runs keep theirs
      const r = aggregateCandidates(items, ugcOnly
        ? { days, minFollowers: 0, maxFollowers: 10_000_000 }
        : { days, minFollowers, maxFollowers });
      ({ candidates, filtered, uniqueCreators } = r);
    }

    // Dedupe by canonical handle against existing same-platform rows across
    // ALL tracks (a LinkedIn person bookmarked in either track is the same
    // person; a same @handle on another platform is someone else).
    const existing = await fetchAllCreators();
    const known = new Set(
      existing.filter((c) => (c.platform || "TikTok") === platform).map((c) => normHandle(c.handle)).filter(Boolean)
    );
    const fresh = candidates.filter((c) => !known.has(normHandle(c.handle)));

    // IG discovery uses a smaller cap — each pass also runs a synchronous
    // profile-enrichment scrape, which takes real time.
    let batch = fresh.slice(0, isIgResearcher ? 30 : BATCH_CAP);
    const remaining = fresh.length - batch.length;
    if (isIgResearcher && batch.length) {
      const enriched = await runInstagram({ usernames: batch.map((c) => c.handle) });
      filtered.enrichFailed = (filtered.enrichFailed || 0) + (batch.length - enriched.length);
      // Laia's follower band — appliable only now that profiles carry counts
      const minF = config.minFollowers ?? 0;
      const maxF = config.maxFollowers ?? 10_000_000;
      const inBand = enriched.filter((c) => (c.followers ?? 0) >= minF && (c.followers ?? 0) <= maxF);
      filtered.followerBand = (filtered.followerBand || 0) + (enriched.length - inBand.length);
      batch = inBand; // private/dead accounts + out-of-band drop out here
    }

    // Progress for the run card's bar: how many of this run's fresh
    // creators have been scored, across all passes so far.
    const priorProcessed = (prior?.summary?.scored || 0) + (prior?.summary?.unscored || 0);
    const totalToProcess = priorProcessed + fresh.length;
    const progressNow = (s) => ({ done: (s.scored || 0) + (s.unscored || 0), total: totalToProcess });

    let scored = 0, inserted = 0, hardRejected = 0, belowThreshold = 0, screened = 0, unscored = 0, raceSkipped = 0;
    const insertFailures = [];
    const misses = [];
    const chunkErrors = [];

    // Everything counted so far, merged over any previous pass — written
    // after every chunk so a timeout or crash still leaves an accurate
    // "partially imported" record instead of silence.
    const summarySoFar = () => {
      misses.sort((a, b) => b.score - a.score);
      return mergeSummaries(prior?.summary, {
        videosFetched: items.length,
        uniqueCreators,
        preFiltered: filtered,
        alreadyKnown: candidates.length - fresh.length,
        scored, hardRejected, belowThreshold, inserted, screened, unscored, raceSkipped,
        insertFailures,
        topMisses: misses.slice(0, 5),
        chunkErrors: chunkErrors.slice(0, 3),
      });
    };

    // Score and insert chunk by chunk: a late failure can no longer discard
    // paid scoring work, and progress is persisted as it happens.
    for (let i = 0; i < batch.length; i += CHUNK) {
      const chunk = batch.slice(i, i + CHUNK);
      let results;
      try {
        ({ results } = await scoreCandidates(chunk, threshold, {
          researcher: track === "researcher" && !isIgResearcher,
          ugcLinkedIn: isUgcLinkedIn,
          igResearcher: isIgResearcher,
          countries,
        }));
      } catch (e) {
        chunkErrors.push(e.message);
        continue;
      }
      for (const c of chunk) {
        const s = results.get(normHandle(c.handle));
        if (!s) { unscored += 1; continue; }
        scored += 1;
        const rejected = s.hard_reject || s.score < threshold;
        if (s.hard_reject) hardRejected += 1;
        else if (s.score < threshold) {
          belowThreshold += 1;
          misses.push({ handle: c.handle, score: s.score, rationale: s.rationale });
        }
        let rationale = s.hard_reject ? `HARD REJECT: ${s.reject_reason || s.rationale}` : s.rationale;
        let niche;
        let insertCandidate = c;
        if (isIgResearcher) {
          // Enriched IG candidate already has real followers/views — keep them
          niche = (s.niche || []).slice(0, 3);
        } else if (track === "researcher") {
          // Prefix the context so the card (which reads Rationale) shows role,
          // employer, grad year and country without new Notion columns.
          const ctx = [
            c.position ? `${c.position}${c.company ? ` @ ${c.company}` : ""}` : c.company,
            c.gradYear ? `grad ${c.gradYear}` : null,
            COUNTRY_LABEL[c.countryCode] || c.countryCode,
          ].filter(Boolean).join(" · ");
          rationale = ctx ? `${ctx} — ${rationale}` : rationale;
          niche = (s.niche || []).slice(0, 3);
          // Store connections in the Followers field (card shows it as "Connections")
          insertCandidate = { ...c, followers: c.connections ?? null, maxViews: null };
        } else if (isUgcLinkedIn) {
          // UGC freelancer from LinkedIn — prefix a headline snippet + country
          const ctx = [(c.headline || "").slice(0, 80), COUNTRY_LABEL[c.countryCode] || c.countryCode].filter(Boolean).join(" · ");
          rationale = ctx ? `${ctx} — ${rationale}` : rationale;
          niche = [...new Set(["ugc", ...(s.niche || [])])].slice(0, 4);
          insertCandidate = { ...c, followers: c.connections ?? null, maxViews: null };
        } else {
          // TikTok/IG UGC — always tag "ugc" (the whole search is UGC-only)
          niche = [...new Set(["ugc", ...(s.niche || [])])].slice(0, 4);
        }
        try {
          // Last line of defence against a concurrent import that slipped past
          // the lock: check right before writing.
          if (await handleExists(c.handle, platform)) { raceSkipped += 1; continue; }
          await createCreator(
            { ...insertCandidate, score: s.score, rationale, niche },
            rejected ? "Screened" : "New",
            owner,
            track
          );
          if (rejected) screened += 1;
          else inserted += 1;
        } catch (e) {
          insertFailures.push({ handle: c.handle, message: e.message });
        }
      }
      // Checkpoint after each chunk — survives a killed function
      const s = summarySoFar();
      await setRunRecord(kvId, RESULT_KEY, { done: false, at: Date.now(), progress: progressNow(s), summary: s }).catch(() => {});
    }

    const summary = summarySoFar();
    await setRunRecord(kvId, RESULT_KEY, {
      done: remaining === 0 && chunkErrors.length === 0,
      at: Date.now(),
      progress: progressNow(summary),
      summary,
    });

    return NextResponse.json({ ...summary, remaining });
  } catch (e) {
    return NextResponse.json({ error: "import", message: e.message }, { status: 502 });
  } finally {
    if (lockTaken && kvId) {
      try { await setRunRecord(kvId, LOCK_KEY, { at: 0 }); } catch {}
    }
  }
}
