import { NextResponse } from "next/server";
import { hasApifyToken, getRun, getDatasetItems, aggregateCandidates } from "@/lib/apify";
import { hasAnthropicKey, scoreCandidates } from "@/lib/scoring";
import { fetchAllCreators, createCreator } from "@/lib/notion";

// Scoring + sequential Notion inserts can take a couple of minutes on a
// large run — allow the full fluid-compute window.
export const maxDuration = 300;

const THRESHOLD = 73;

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

  try {
    const run = await getRun(body.runId);
    if (run.status !== "SUCCEEDED") {
      return NextResponse.json(
        { error: "run-state", message: `Run is ${run.status}; import only finished runs.` },
        { status: 409 }
      );
    }

    const items = await getDatasetItems(run.defaultDatasetId);
    const days = body.days || 30;
    const { candidates, filtered, uniqueCreators } = aggregateCandidates(items, { days });

    // Dedupe by handle against the entire existing database
    const existing = await fetchAllCreators();
    const known = new Set(
      existing.map((c) => (c.handle || "").toLowerCase().replace(/^@/, "")).filter(Boolean)
    );
    const fresh = candidates.filter((c) => !known.has(c.handle.toLowerCase().replace(/^@/, "")));

    let scored = 0, inserted = 0, hardRejected = 0, belowThreshold = 0, screened = 0;
    const insertFailures = [];
    const misses = [];
    if (fresh.length > 0) {
      const { results } = await scoreCandidates(fresh);
      for (const c of fresh) {
        const s = results.get(c.handle.toLowerCase());
        if (!s) continue;
        scored += 1;
        const rejected = s.hard_reject || s.score < THRESHOLD;
        if (s.hard_reject) hardRejected += 1;
        else if (s.score < THRESHOLD) {
          belowThreshold += 1;
          misses.push({ handle: c.handle, score: s.score, rationale: s.rationale });
        }
        const rationale = s.hard_reject ? `HARD REJECT: ${s.reject_reason || s.rationale}` : s.rationale;
        try {
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
    // Surface the best near-misses so a zero-insert import is explainable
    // (usually a sign the hashtags were off-ICP, not a system failure).
    misses.sort((a, b) => b.score - a.score);

    return NextResponse.json({
      videosFetched: items.length,
      uniqueCreators,
      preFiltered: filtered,
      alreadyKnown: candidates.length - fresh.length,
      scored,
      hardRejected,
      belowThreshold,
      inserted,
      screened,
      insertFailures,
      topMisses: misses.slice(0, 5),
    });
  } catch (e) {
    return NextResponse.json({ error: "import", message: e.message }, { status: 502 });
  }
}
