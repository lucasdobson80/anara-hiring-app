const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR = "clockworks~tiktok-scraper";

// Rough pay-per-result rate for clockworks/tiktok-scraper, used only for
// pre-run estimates shown in the UI. Real spend comes from the Apify API.
export const EST_USD_PER_RESULT = 0.005;

export function hasApifyToken() {
  return Boolean(process.env.APIFY_TOKEN);
}

async function apifyFetch(path, opts = {}) {
  const res = await fetch(`${APIFY_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.APIFY_TOKEN}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify ${res.status}: ${text.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
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

export async function startRun({ hashtags, searchQueries, resultsPerPage, days, maxItems }) {
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
  // Keyword search reaches creators hashtag top-posts never surface
  if (searchQueries?.length) {
    input.searchQueries = searchQueries;
    input.searchSection = "/video";
    input.videoSearchSorting = "MOST_RELEVANT";
    // Actor's allowed values: ALL_TIME, PAST_24_HOURS, PAST_WEEK, PAST_MONTH, LAST_3_MONTHS, LAST_6_MONTHS
    input.videoSearchDateFilter =
      days <= 1 ? "PAST_24_HOURS" :
      days <= 7 ? "PAST_WEEK" :
      days <= 31 ? "PAST_MONTH" :
      days <= 93 ? "LAST_3_MONTHS" :
      days <= 186 ? "LAST_6_MONTHS" : "ALL_TIME";
  }
  const { data } = await apifyFetch(`/acts/${ACTOR}/runs?maxItems=${maxItems}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data;
}

export async function getDatasetItems(datasetId) {
  // Paginate so nothing is silently dropped if run caps ever grow
  const all = [];
  let offset = 0;
  while (all.length < 5000) {
    const page = await apifyFetch(`/datasets/${datasetId}/items?clean=true&limit=1000&offset=${offset}`);
    all.push(...(page || []));
    if (!page || page.length < 1000) break;
    offset += 1000;
  }
  return all;
}

// Synchronous small scrape (manual adds): waits for the run and returns the
// dataset items in one call. Only for small inputs — a handful of profiles.
const IG_ACTOR = "apify~instagram-scraper";
const IG_EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const IG_RESERVED = ["reel", "reels", "p", "tv", "explore", "stories", "s", "direct", "accounts", "about", "legal"];

export function isIgReserved(u) {
  return IG_RESERVED.includes(String(u).toLowerCase());
}

// Instagram actor is pay-per-result with a per-run minimum charge, so a
// maxTotalChargeUsd must be passed (sized to how many URLs were pasted).
async function runSyncActor(actorId, input, maxTotalChargeUsd) {
  const items = await apifyFetch(
    `/acts/${actorId}/run-sync-get-dataset-items?timeout=150&memory=2048&maxTotalChargeUsd=${maxTotalChargeUsd}`,
    { method: "POST", body: JSON.stringify(input) }
  );
  return items || [];
}

// Scrape hand-picked Instagram creators: reel/post links are resolved to
// their owner first, then every creator's profile is scraped for followers,
// bio (email), and their best recent reel's plays. Returns our candidate shape.
export async function runInstagram({ usernames = [], postUrls = [] }) {
  const reelStats = new Map(); // username -> best pasted-reel views + timestamp
  const allUsers = new Set(usernames.map((u) => u.toLowerCase()));

  if (postUrls.length) {
    // "posts" resolves a reel/post URL to its owner + that clip's plays fast;
    // "details" on a post URL hangs.
    const posts = await runSyncActor(
      IG_ACTOR,
      { directUrls: postUrls, resultsType: "posts", resultsLimit: 1 },
      Math.max(0.1, postUrls.length * 0.05)
    );
    for (const it of posts) {
      const u = (it.ownerUsername || "").toLowerCase();
      if (!u) continue;
      allUsers.add(u);
      const views = it.videoViewCount ?? it.videoPlayCount ?? 0;
      const prev = reelStats.get(u);
      if (!prev || views > prev.maxViews) reelStats.set(u, { maxViews: views, timestamp: it.timestamp });
    }
  }
  if (!allUsers.size) return [];

  const profileUrls = [...allUsers].map((u) => `https://www.instagram.com/${u}/`);
  const profs = await runSyncActor(
    IG_ACTOR,
    { directUrls: profileUrls, resultsType: "details", resultsLimit: 1 },
    Math.max(0.1, profileUrls.length * 0.05)
  );

  const out = [];
  for (const p of profs) {
    const u = (p.username || "").toLowerCase();
    if (!u) continue;
    const posts = p.latestPosts || [];
    const bestReel = posts.reduce((m, x) => Math.max(m, x.videoViewCount || 0), 0);
    const rs = reelStats.get(u);
    out.push({
      handle: p.username,
      name: p.fullName || p.username,
      profileUrl: `https://www.instagram.com/${u}/`,
      signature: p.biography || "",
      email: (String(p.biography || "").match(IG_EMAIL_RX) || [])[0] || null,
      followers: p.followersCount ?? null,
      maxViews: Math.max(bestReel, rs?.maxViews || 0),
      videoCount: posts.filter((x) => x.type === "Video").length || 1,
      latestPost: posts[0]?.timestamp || rs?.timestamp || null,
      sampleTexts: posts.slice(0, 3).map((x) => String(x.caption || "").slice(0, 150)).filter(Boolean),
      platform: "Instagram",
    });
  }
  return out;
}

export async function runSyncItems(input, { maxItems = 200 } = {}) {
  // Low memory + short timeout keep Apify's up-front usage reservation small
  // (it reserves worst-case cost before running, which can block on tight plans)
  const items = await apifyFetch(
    `/acts/${ACTOR}/run-sync-get-dataset-items?maxItems=${maxItems}&timeout=120&memory=1024`,
    { method: "POST", body: JSON.stringify(input) }
  );
  return items || [];
}

// Import lock + result live in the run's own key-value store, so any device
// (and any concurrent invocation) sees the same import state.
export async function getRunRecord(kvStoreId, key) {
  try {
    return await apifyFetch(`/key-value-stores/${kvStoreId}/records/${key}`);
  } catch (e) {
    if (String(e.message).startsWith("Apify 404")) return null;
    throw e;
  }
}

export async function setRunRecord(kvStoreId, key, value) {
  await apifyFetch(`/key-value-stores/${kvStoreId}/records/${key}`, {
    method: "PUT",
    body: JSON.stringify(value),
  });
}

// The INPUT record of a run's key-value store (returns the raw input object)
export async function getRunInput(kvStoreId) {
  return apifyFetch(`/key-value-stores/${kvStoreId}/records/INPUT`);
}

export async function getDatasetInfo(datasetId) {
  const { data } = await apifyFetch(`/datasets/${datasetId}`);
  return data;
}

// Collapse raw video items into one candidate per creator, applying the
// cheap mechanical ICP filters before anything reaches the scoring model.
// lenient=true (manual adds): the human already vetted them — skip the
// mechanical follower/staleness/language filters entirely.
export function aggregateCandidates(items, { days, minFollowers = 1000, maxFollowers = 150000, lenient = false }) {
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

  const emailRx = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const candidates = [];
  const filtered = { followers: 0, stale: 0, language: 0 };
  for (const c of byHandle.values()) {
    // Business email creators put in their bio — a warmer outreach channel
    c.email = (c.signature.match(emailRx) || [null])[0];
    if (lenient) { candidates.push({ ...c, languages: undefined }); continue; }
    if (c.followers != null && (c.followers < minFollowers || c.followers > maxFollowers)) { filtered.followers += 1; continue; }
    // Nano accounts post less often — give them double the recency window
    const staleCutoff = c.followers != null && c.followers < 5000
      ? Date.now() - days * 2 * 24 * 3600 * 1000
      : cutoff;
    if (c.latestPost && new Date(c.latestPost).getTime() < staleCutoff) { filtered.stale += 1; continue; }
    if (c.languages.size > 0 && !c.languages.has("en")) { filtered.language += 1; continue; }
    candidates.push({ ...c, languages: undefined });
  }
  return { candidates, filtered, uniqueCreators: byHandle.size };
}
