import { NextResponse } from "next/server";
import { hasApifyToken, getSpend, listRuns, getRunInput, getDatasetInfo, EST_USD_PER_RESULT } from "@/lib/apify";
import { hasAnthropicKey } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export async function GET() {
  const ready = { apify: hasApifyToken(), anthropic: hasAnthropicKey() };
  if (!ready.apify) {
    return NextResponse.json({ ready, spend: null, runs: [], estPerResult: EST_USD_PER_RESULT });
  }
  try {
    const [spend, rawRuns] = await Promise.all([getSpend(), listRuns(12)]);
    const runs = await Promise.all(
      rawRuns.map(async (r) => {
        const [input, dataset] = await Promise.all([
          r.defaultKeyValueStoreId ? getRunInput(r.defaultKeyValueStoreId).catch(() => null) : null,
          r.defaultDatasetId ? getDatasetInfo(r.defaultDatasetId).catch(() => null) : null,
        ]);
        return {
          id: r.id,
          status: r.status,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          usageUsd: r.usageTotalUsd ?? null,
          datasetId: r.defaultDatasetId ?? null,
          hashtags: input?.hashtags || [],
          videos: dataset?.itemCount ?? null,
        };
      })
    );
    return NextResponse.json({ ready, spend, estPerResult: EST_USD_PER_RESULT, runs });
  } catch (e) {
    return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
  }
}
