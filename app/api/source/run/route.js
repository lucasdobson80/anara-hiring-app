import { NextResponse } from "next/server";
import { hasApifyToken, startRun, startResearcherRun, setRunRecord } from "@/lib/apify";
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

  // ── Researcher track: LinkedIn people-search (Laia's pharma/biotech/CRO) ──
  if (body.track === "researcher") {
    const roles = (body.roles || []).map((r) => String(r).trim()).filter(Boolean).slice(0, 15);
    const countries = (body.countries || []).map((c) => String(c).trim()).filter(Boolean).slice(0, 6);
    if (!roles.length || !countries.length) {
      return NextResponse.json({ error: "bad-request", message: "Pick at least one role and one country." }, { status: 400 });
    }
    const maxItems = clamp(body.maxItems, 5, 1000, 100);
    const threshold = clamp(body.threshold, 60, 85, 70);
    const owner = await currentUser();
    try {
      const run = await startResearcherRun({ roles, countries, activeRecently: Boolean(body.activeRecently), maxItems });
      if (run.defaultKeyValueStoreId) {
        await setRunRecord(run.defaultKeyValueStoreId, "CASTING_DESK_CONFIG", {
          track: "researcher", threshold, owner, roles, countries,
        }).catch(() => {});
      }
      return NextResponse.json({ id: run.id, status: run.status });
    } catch (e) {
      return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
    }
  }

  const hashtags = (body.hashtags || []).map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean);
  const searchQueries = (body.searchQueries || []).map((q) => String(q).trim()).filter(Boolean).slice(0, 6);
  const resultsPerPage = clamp(body.resultsPerPage, 1, 200, 60);
  const days = clamp(body.days, 1, 365, 30);
  const maxItems = clamp(body.maxItems, 10, 1500, 500);
  const minFollowers = clamp(body.minFollowers, 0, 10_000_000, 500);
  const maxFollowers = clamp(body.maxFollowers, minFollowers, 10_000_000, 15000);
  const threshold = clamp(body.threshold, 60, 85, 70);
  const ugcMode = Boolean(body.ugcMode);
  if (!hashtags.length && !searchQueries.length) {
    return NextResponse.json({ error: "bad-request", message: "At least one hashtag or search term is required." }, { status: 400 });
  }
  const owner = await currentUser();
  try {
    const run = await startRun({ hashtags, searchQueries, resultsPerPage, days, maxItems });
    // Persist the run's own import settings + owner next to it, so import (auto
    // or manual, any device) applies exactly what this run was launched with.
    if (run.defaultKeyValueStoreId) {
      await setRunRecord(run.defaultKeyValueStoreId, "CASTING_DESK_CONFIG", {
        days, minFollowers, maxFollowers, threshold, owner, ugcMode,
      }).catch(() => {});
    }
    return NextResponse.json({ id: run.id, status: run.status });
  } catch (e) {
    return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
  }
}
