import { NextResponse } from "next/server";
import { hasApifyToken, getSpend, listAllRuns, getRunInput, getDatasetInfo, getRunRecord, getSetting, EST_USD_PER_RESULT, IG_ACTOR_ID } from "@/lib/apify";
import { hasAnthropicKey } from "@/lib/scoring";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await currentUser();
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") === "all" ? "all" : "mine";
  // creator|researcher filters run cards to that track; absent (the shell
  // watcher) sees every launched run so it can import any of them.
  const trackParam = params.get("track");
  const track = trackParam === "researcher" || trackParam === "creator" ? trackParam : null;
  const ready = { apify: hasApifyToken(), anthropic: hasAnthropicKey() };
  if (!ready.apify) {
    return NextResponse.json({ ready, spend: null, runs: [], estPerResult: EST_USD_PER_RESULT, user });
  }
  try {
    const [spend, rawRuns, liCursor] = await Promise.all([
      getSpend(), listAllRuns(20),
      track === "creator" ? getSetting("LI_UGC_CURSOR").catch(() => null) : Promise.resolve(null),
    ]);
    let runs = await Promise.all(
      rawRuns.map(async (r) => {
        const [input, dataset, importRecord, config] = await Promise.all([
          r.defaultKeyValueStoreId ? getRunInput(r.defaultKeyValueStoreId).catch(() => null) : null,
          r.defaultDatasetId ? getDatasetInfo(r.defaultDatasetId).catch(() => null) : null,
          r.defaultKeyValueStoreId ? getRunRecord(r.defaultKeyValueStoreId, "CASTING_DESK_IMPORT").catch(() => null) : null,
          r.defaultKeyValueStoreId ? getRunRecord(r.defaultKeyValueStoreId, "CASTING_DESK_CONFIG").catch(() => null) : null,
        ]);
        return {
          // IG-actor runs without a launch config are Organic's sync scrapes,
          // not sourcing runs — hide them from the list below.
          hideRun: r.actId === IG_ACTOR_ID && !config,
          runOwner: config?.owner || "lucas",
          runTrack: config?.track || "creator",
          runPlatform: config?.platform || (config?.track === "researcher" ? "LinkedIn" : "TikTok"),
          label: config?.label || null,
          id: r.id,
          status: r.status,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          usageUsd: r.usageTotalUsd ?? null,
          datasetId: r.defaultDatasetId ?? null,
          hashtags: input?.hashtags || [],
          roles: config?.roles || [],
          countries: config?.countries || [],
          videos: dataset?.itemCount ?? null,
          // Server-side import state: shared across devices, unlike localStorage
          importResult: importRecord ? { done: importRecord.done, at: importRecord.at, progress: importRecord.progress || null, summary: importRecord.summary } : null,
        };
      })
    );
    runs = runs.filter((r) => !r.hideRun);
    // "Mine" shows only your runs; "All team" shows everyone's. Spend is shared.
    if (scope !== "all") runs = runs.filter((r) => r.runOwner === user);
    // When a track is given, only that track's runs (the shell watcher passes
    // none, so it still sees every launched run to import).
    if (track) runs = runs.filter((r) => r.runTrack === track);
    return NextResponse.json({ ready, spend, estPerResult: EST_USD_PER_RESULT, runs, user, scope, liCursor });
  } catch (e) {
    return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
  }
}
