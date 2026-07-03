import { NextResponse } from "next/server";
import {
  hasApifyToken, getRun, getDatasetItems, aggregateCandidates, getRunRecord, setRunRecord,
} from "@/lib/apify";
import { hasAnthropicKey, scoreCandidates } from "@/lib/scoring";
import { fetchAllCreators, createCreator, handleExists, normHandle } from "@/lib/notion";

// Scoring + sequential Notion inserts take minutes — use the full window,
// and cap the per-invocation batch so we never hit the ceiling mid-write.
export const maxDuration = 300;

const THRESHOLD = 73;
const BATCH_CAP = 200; // fresh creators processed per invocation
const CHUNK = 20; // candidates per scoring call
const LOCK_KEY = "CASTING_DESK_LOCK";
const RESULT_KEY = "CASTING_DESK_IMPORT";
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

    const items = await getDatasetItems(run.defaultDatasetId);
    const days = body.days || 30;
    const { candidates, filtered, uniqueCreators } = aggregateCandidates(items, { days });

    // Dedupe by canonical handle against the entire existing database
    const existing = await fetchAllCreators();
    const known = new Set(existing.map((c) => normHandle(c.handle)).filter(Boolean));
    const fresh = candidates.filter((c) => !known.has(normHandle(c.handle)));

    const batch = fresh.slice(0, BATCH_CAP);
    const remaining = fresh.length - batch.length;

    let scored = 0, inserted = 0, hardRejected = 0, belowThreshold = 0, screened = 0, unscored = 0, raceSkipped = 0;
    const insertFailures = [];
    const misses = [];
    const chunkErrors = [];

    // Score and insert chunk by chunk: a late failure can no longer discard
    // paid scoring work, and progress is persisted as it happens.
    for (let i = 0; i < batch.length; i += CHUNK) {
      const chunk = batch.slice(i, i + CHUNK);
      let results;
      try {
        ({ results } = await scoreCandidates(chunk));
      } catch (e) {
        chunkErrors.push(e.message);
        continue;
      }
      for (const c of chunk) {
        const s = results.get(normHandle(c.handle));
        if (!s) { unscored += 1; continue; }
        scored += 1;
        const rejected = s.hard_reject || s.score < THRESHOLD;
        if (s.hard_reject) hardRejected += 1;
        else if (s.score < THRESHOLD) {
          belowThreshold += 1;
          misses.push({ handle: c.handle, score: s.score, rationale: s.rationale });
        }
        const rationale = s.hard_reject ? `HARD REJECT: ${s.reject_reason || s.rationale}` : s.rationale;
        try {
          // Last line of defence against a concurrent import that slipped past
          // the lock: check right before writing.
          if (await handleExists(c.handle)) { raceSkipped += 1; continue; }
          await createCreator(
            { ...c, score: s.score, rationale, niche: s.niche },
            rejected ? "Screened" : "New"
          );
          if (rejected) screened += 1;
          else inserted += 1;
        } catch (e) {
          insertFailures.push({ handle: c.handle, message: e.message });
        }
      }
    }

    misses.sort((a, b) => b.score - a.score);
    const summary = mergeSummaries(prior?.summary, {
      videosFetched: items.length,
      uniqueCreators,
      preFiltered: filtered,
      alreadyKnown: candidates.length - fresh.length,
      scored, hardRejected, belowThreshold, inserted, screened, unscored, raceSkipped,
      insertFailures,
      topMisses: misses.slice(0, 5),
      chunkErrors: chunkErrors.slice(0, 3),
    });
    await setRunRecord(kvId, RESULT_KEY, { done: remaining === 0 && chunkErrors.length === 0, at: Date.now(), summary });

    return NextResponse.json({ ...summary, remaining });
  } catch (e) {
    return NextResponse.json({ error: "import", message: e.message }, { status: 502 });
  } finally {
    if (lockTaken && kvId) {
      try { await setRunRecord(kvId, LOCK_KEY, { at: 0 }); } catch {}
    }
  }
}
