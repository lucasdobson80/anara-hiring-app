const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR = "clockworks~tiktok-scraper";

// Rough pay-per-result rate for clockworks/tiktok-scraper, used only for
// pre-run estimates shown in the UI. Real spend comes from the Apify API.
export const EST_USD_PER_RESULT = 0.005;

export function hasApifyToken() {
  return Boolean(process.env.APIFY_TOKEN);
}

async function apifyFetch(path, opts = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${APIFY_BASE}${path}${sep}token=${process.env.APIFY_TOKEN}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Current billing-cycle usage and plan limit
export async function getSpend() {
  const { data } = await apifyFetch("/users/me/limits");
  return {
    monthlyUsageUsd: data?.current?.monthlyUsageUsd ?? null,
    maxMonthlyUsageUsd: data?.limits?.maxMonthlyUsageUsd ?? null,
    cycleStart: data?.monthlyUsageCycle?.startAt ?? null,
    cycleEnd: data?.monthlyUsageCycle?.endAt ?? null,
  };
}

export async function listRuns(limit = 8) {
  const { data } = await apifyFetch(`/acts/${ACTOR}/runs?desc=true&limit=${limit}`);
  return data?.items ?? [];
}

export async function getRun(runId) {
  const { data } = await apifyFetch(`/actor-runs/${runId}`);
  return data;
}

export async function startRun({ hashtags, resultsPerPage, days, maxItems }) {
  const oldest = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const input = {
    hashtags,
    resultsPerPage,
    oldestPostDateUnified: oldest,
    excludePinnedPosts: true,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
  };
  const { data } = await apifyFetch(`/acts/${ACTOR}/runs?maxItems=${maxItems}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data;
}

export async function getDatasetItems(datasetId) {
  // Returns a plain array (not wrapped in {data})
  return apifyFetch(`/datasets/${datasetId}/items?clean=true&limit=2000`);
}

// Collapse raw video items into one candidate per creator, applying the
// cheap mechanical ICP filters before anything reaches the scoring model.
export function aggregateCandidates(items, { days }) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const byHandle = new Map();
  for (const item of items) {
    const a = item.authorMeta;
    if (!a?.name) continue;
    const handle = a.name.toLowerCase();
    const existing = byHandle.get(handle) || {
      handle: a.name,
      name: a.nickName || a.name,
      profileUrl: a.profileUrl || `https://www.tiktok.com/@${a.name}`,
      signature: a.signature || "",
      followers: a.fans ?? null,
      maxViews: 0,
      videoCount: 0,
      latestPost: null,
      sampleTexts: [],
      languages: new Set(),
    };
    existing.videoCount += 1;
    existing.maxViews = Math.max(existing.maxViews, item.playCount || 0);
    if (item.createTimeISO && (!existing.latestPost || item.createTimeISO > existing.latestPost)) {
      existing.latestPost = item.createTimeISO;
    }
    if (item.text && existing.sampleTexts.length < 3) existing.sampleTexts.push(item.text.slice(0, 150));
    if (item.textLanguage) existing.languages.add(item.textLanguage);
    byHandle.set(handle, existing);
  }

  const candidates = [];
  const filtered = { followers: 0, stale: 0, language: 0 };
  for (const c of byHandle.values()) {
    if (c.followers != null && (c.followers < 1000 || c.followers > 150000)) { filtered.followers += 1; continue; }
    if (c.latestPost && new Date(c.latestPost).getTime() < cutoff) { filtered.stale += 1; continue; }
    if (c.languages.size > 0 && !c.languages.has("en")) { filtered.language += 1; continue; }
    candidates.push({ ...c, languages: undefined });
  }
  return { candidates, filtered, uniqueCreators: byHandle.size };
}
