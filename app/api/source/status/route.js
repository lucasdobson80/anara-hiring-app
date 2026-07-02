import { NextResponse } from "next/server";
import { hasApifyToken, getSpend, listRuns, EST_USD_PER_RESULT } from "@/lib/apify";
import { hasAnthropicKey } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export async function GET() {
  const ready = { apify: hasApifyToken(), anthropic: hasAnthropicKey() };
  if (!ready.apify) {
    return NextResponse.json({ ready, spend: null, runs: [], estPerResult: EST_USD_PER_RESULT });
  }
  try {
    const [spend, runs] = await Promise.all([getSpend(), listRuns(8)]);
    return NextResponse.json({
      ready,
      spend,
      estPerResult: EST_USD_PER_RESULT,
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        usageUsd: r.usageTotalUsd ?? null,
        datasetId: r.defaultDatasetId ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: "apify", message: e.message }, { status: 502 });
  }
}
