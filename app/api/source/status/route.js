import { NextResponse } from "next/server";
import { hasApifyToken, getSpend, listRuns, getRunInput, getDatasetInfo, getRunRecord, EST_USD_PER_RESULT } from "@/lib/apify";
import { hasAnthropicKey } from "@/lib/scoring";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await currentUser();
  const scope = new URL(request.url).searchParams.get("scope") === "all" ? "all" : "mine";
  const ready = { apify: hasApifyToken(), anthropic: hasAnthropicKey() };
  if (!ready.apify) {
    return NextResponse.json({ ready, spend: null, runs: [], estPerResult: EST_USD_PER_RESULT, user });
  }
  try {
    const [spend, rawRuns] = await Promise.all([getSpend(), listRuns(20)]);
    let runs = await Promise.all(
      rawRuns.map(async (r) => {
        const [input, dataset, importRecord, config] = await Promise.all([
          r.defaultKeyValueStoreId ? getRunInput(r.defaultKeyValueStoreId).catch(() => null) : null,
          r.defaultDatasetId ? getDatasetInfo(r.defaultDatasetId).catch(() => null) : null,
          r.defaultKeyValueStoreId ? getRunRecord(r.defaultKeyValueStoreId, "CASTING_DESK_IMPORT").catch(() => null) : null,
          r.defaultKeyValueStoreId ? getRunRecord(r.defaultKeyValueStoreId, "CASTING_DESK_CONFIG").catch(() => null) : null,
        ]);
        return {
          runOwner: config?.owner || "lucas",
          id: r.id,
          status: r.status,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          usageUsd: r.usageTotalUsd ?? null,
          datasetId: r.defaultDatasetId ?? null,
          hashtags: input?.hashtags || [],
          videos: dataset?.itemCount ?? null,
          // Server-side import state: shared across devices, unlike localStorage
          importResult: importRecord ? { done: importRecord.done, at: importRecord.at, progress: importRecord.progress || null, summary: importRecord.summary } : null,
        };
      })
    );
    // "Mine" shows only your runs; "All team" shows everyone's. Spend is shared.
    if (scope !== "all") runs = runs.filter((r) => r.runOwner === user);
    return NextResponse.json({ ready, spend, estPerResult: EST_USD_PER_RESULT, runs, user, scope });
  } catch (e) {
    return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
  }
}
