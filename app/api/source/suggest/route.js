import { NextResponse } from "next/server";
import { hasApifyToken, listRuns, getRunInput, getRunRecord } from "@/lib/apify";
import { hasAnthropicKey, suggestRuns } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!hasApifyToken() || !hasAnthropicKey()) {
    return NextResponse.json({ error: "setup", message: "APIFY_TOKEN and ANTHROPIC_API_KEY are required." }, { status: 503 });
  }
  try {
    const runs = await listRuns(12);
    const lines = await Promise.all(
      runs.map(async (r) => {
        const [input, record] = await Promise.all([
          r.defaultKeyValueStoreId ? getRunInput(r.defaultKeyValueStoreId).catch(() => null) : null,
          r.defaultKeyValueStoreId ? getRunRecord(r.defaultKeyValueStoreId, "CASTING_DESK_IMPORT").catch(() => null) : null,
        ]);
        const s = record?.summary;
        const yieldTxt = s
          ? `yield: ${s.inserted} added to review, ${s.screened} screened, ${s.alreadyKnown} already known of ${s.videosFetched} videos`
          : "not imported";
        return `- ${r.startedAt?.slice(0, 10)} hashtags: [${(input?.hashtags || []).join(", ")}] search: [${(input?.searchQueries || []).join(", ")}] → ${yieldTxt}`;
      })
    );
    const history = `Recent run history (newest first):\n${lines.join("\n") || "(no runs yet)"}\n\nPropose 3 new runs.`;
    const data = await suggestRuns(history);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: "suggest", message: e.message }, { status: 502 });
  }
}
