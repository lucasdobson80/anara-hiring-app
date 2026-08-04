const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR = "clockworks~tiktok-scraper";
// LinkedIn people-search (cookieless, validated Jul 2026). Returns full
// profiles: headline, about, education (with dates), current position, photo.
export const LI_ACTOR = "harvestapi~linkedin-profile-search";

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

export async function listRuns(limit = 8, actor = ACTOR) {
  const { data } = await apifyFetch(`/acts/${actor}/runs?desc=true&limit=${limit}`);
  return data?.items ?? [];
}

// Both pipelines' runs, newest first — creator (TikTok) and researcher
// (LinkedIn). Each run's KV config.track tells import which path to take.
// Email notifications via Apify's free send-mail utility actor — no extra
// accounts or keys. Fire on form applications; never let a mail failure
// break the caller.
export async function sendNotificationEmail({ subject, text }) {
  const to = process.env.APPLY_NOTIFY_EMAIL || "theexamplanner@gmail.com";
  await apifyFetch(`/acts/apify~send-mail/runs`, {
    method: "POST",
    body: JSON.stringify({ to, subject, text }),
  });
}

// The Instagram actor also serves Organic's small sync scrapes — those runs
// carry no CASTING_DESK_CONFIG, and the status route drops them from the list.
export const IG_ACTOR_ID = "shu8hvrXbJbY3Eb9W";

export async function listAllRuns(limit = 20) {
  const [tk, li, ig] = await Promise.all([
    listRuns(limit, ACTOR).catch(() => []),
    listRuns(limit, LI_ACTOR).catch(() => []),
    listRuns(limit, IG_ACTOR).catch(() => []),
  ]);
  return [...tk, ...li, ...ig].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit);
}

// Start a LinkedIn people-search run. roles → currentJobTitles, countries →
// locations. Senior levels + freelance/recruiter titles excluded up front;
// the scoring rubric does the fine-grained judgment.
const LI_EXCLUDE_TITLES = ["Freelance", "Consultant", "Recruiter", "Talent", "Director", "Head of", "Senior", "Principal", "Lead", "VP", "Vice President", "Owner", "Founder"];
// Each distinct search combination (roles + countries + active-recently)
// keeps its OWN page cursor, so re-running a favourite search walks fresh
// profiles weekly while changing the mix never skips anyone.
export function researcherCursorKey(roles, countries, activeRecently) {
  const s = [...roles].sort().join("|") + "§" + [...countries].sort().join("|") + (activeRecently ? "§active" : "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "LI_RES_CURSOR_" + h.toString(36);
}

export async function startResearcherRun({ roles, countries, activeRecently, maxItems }) {
  const cursorKey = researcherCursorKey(roles, countries, activeRecently);
  const takePages = Math.max(1, Math.ceil(maxItems / 25));
  const cursor = (await getSetting(cursorKey)) || {};
  const startPage = Math.max(1, cursor.startPage || 1);
  const input = {
    profileScraperMode: "Full",
    currentJobTitles: roles,
    locations: countries,
    excludeSeniorityLevelIds: ["120", "130", "200", "210", "220", "300", "310", "320"],
    excludeCurrentJobTitles: LI_EXCLUDE_TITLES,
    maxItems,
    startPage,
    takePages,
  };
  if (activeRecently) input.recentlyPostedOnLinkedIn = true;
  const { data } = await apifyFetch(`/acts/${LI_ACTOR}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  await setSetting(cursorKey, { startPage: startPage + takePages, at: Date.now() });
  return { ...data, startPage, takePages, cursorKey };
}

// ── Researcher Instagram hunt (Laia): three discovery modes launched as
// separate runs from one button — account search by role keywords, a
// rotating researcher-hashtag sweep, and related-profiles crawling from
// her existing Instagram finds. Search results and post owners carry no
// bio, so the import step enriches profiles before scoring. ──
export const RESEARCH_IG_POOL = [
  "clinicalresearch", "clinicalresearchassociate", "clinicaltrials", "medicalwriter",
  "regulatoryaffairs", "pharmacovigilance", "pharmd", "pharmacystudent", "biotech",
  "lablife", "labtech", "scicomm", "medcomms", "pharmacist",
];

const IG_TAGS_LAST_KEY = "IG_RES_LAST_TAGS";

export async function startResearcherIgRuns({ roles, maxItems, seeds = [] }) {
  const runs = [];
  const startIg = async (input, chargeUsd) => {
    const { data } = await apifyFetch(
      `/acts/${IG_ACTOR}/runs?maxTotalChargeUsd=${Math.max(1, Math.ceil(chargeUsd))}`,
      { method: "POST", body: JSON.stringify(input) }
    );
    return data;
  };

  // A — account search: comma-separated role keywords, one run
  const searchLimit = Math.min(150, Math.max(10, maxItems));
  runs.push({
    mode: "search",
    label: `Research · IG search · ${roles.slice(0, 2).join(", ")}${roles.length > 2 ? ` +${roles.length - 2}` : ""}`,
    // resultsType details: return the found ACCOUNTS, not their post feeds
    run: await startIg(
      { search: roles.join(","), searchType: "user", searchLimit, resultsType: "details", resultsLimit: 1 },
      searchLimit * 0.005 + 1
    ),
  });

  // B — hashtag sweep: 6 rotated tags, recent posts only (active posters)
  const last = (await getSetting(IG_TAGS_LAST_KEY)) || {};
  const avoid = new Set(last.tags || []);
  const freshTags = RESEARCH_IG_POOL.filter((t) => !avoid.has(t));
  const bag = [...freshTags, ...RESEARCH_IG_POOL.filter((t) => avoid.has(t))];
  const tags = bag.slice(0, 6);
  const perTag = Math.min(100, Math.max(10, Math.ceil((maxItems * 2) / tags.length)));
  runs.push({
    mode: "hashtags",
    label: "Research · IG tags · #" + tags.slice(0, 3).join(" #") + ` +${tags.length - 3}`,
    run: await startIg(
      {
        directUrls: tags.map((t) => `https://www.instagram.com/explore/tags/${t}/`),
        resultsType: "posts",
        resultsLimit: perTag,
        onlyPostsNewerThan: "60 days",
      },
      tags.length * perTag * 0.005 + 1
    ),
  });
  await setSetting(IG_TAGS_LAST_KEY, { tags, at: Date.now() });

  // C — related profiles: crawl accounts Instagram suggests next to her
  // existing finds (precision layer; skipped until seeds exist)
  if (seeds.length) {
    runs.push({
      mode: "related",
      label: `Research · IG similar · ${seeds.length} seed${seeds.length > 1 ? "s" : ""}`,
      run: await startIg(
        {
          directUrls: seeds.map((u) => `https://www.instagram.com/${u}/`),
          resultsType: "details",
          resultsLimit: 1,
        },
        seeds.length * 0.05 + 0.5
      ),
    });
  }
  return runs;
}

// Pull candidate usernames out of a discovery run's dataset, per mode.
export function igUsernamesFromItems(items, igMode) {
  const names = new Set();
  for (const it of items || []) {
    if (igMode === "hashtags") {
      if (it.ownerUsername) names.add(String(it.ownerUsername).toLowerCase());
    } else if (igMode === "related") {
      for (const r of it.relatedProfiles || []) {
        if (r?.username && !r.is_private) names.add(String(r.username).toLowerCase());
      }
    } else {
      // search results are account details; tolerate post items too (the
      // actor's default resultsType feeds posts of the found accounts)
      const u = it.username || it.ownerUsername;
      if (u) names.add(String(u).toLowerCase());
    }
  }
  return [...names].filter((u) => u && !isIgReserved(u));
}

export async function getRun(runId) {
  const { data } = await apifyFetch(`/actor-runs/${runId}`);
  return data;
}

export async function startRun({ hashtags, searchQueries, resultsPerPage, days, maxItems, proxyCountryCode }) {
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
  // Bias the scrape toward a target country (actor supports a proxy country).
  // TikTok can't hard-filter by country, so this is best-effort; scoring does
  // the real country gate.
  if (proxyCountryCode && proxyCountryCode !== "None") input.proxyCountryCode = proxyCountryCode;
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

// Working UGC creators advertise themselves — bio keywords, portfolio links,
// business email. These are the strongest reply predictors we have.
export function detectUgcSignals(signature = "", email = null, sampleTexts = []) {
  const hay = `${signature} ${sampleTexts.join(" ")}`.toLowerCase();
  const signals = [];
  if (/\bugc\b|user.generated|content creator for hire|for collabs|collabs open|brand deals?|dm for collab|📩|inquiries/i.test(hay)) signals.push("ugc-bio");
  if (/beacons\.ai|stan\.store|linktr\.ee|linktree|milkshake\.app|carrd\.co|portfolio/i.test(hay)) signals.push("portfolio");
  if (email) signals.push("email");
  return signals;
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
      ugcSignals: detectUgcSignals(p.biography || "", (String(p.biography || "").match(IG_EMAIL_RX) || [])[0] || null, posts.slice(0, 3).map((x) => String(x.caption || ""))),
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
    c.ugcSignals = detectUgcSignals(c.signature, c.email, c.sampleTexts);
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

// Collapse raw LinkedIn profile items into our candidate shape, applying the
// cheap mechanical filters (country / employed-now / open-to-work / has-text)
// before anything reaches the researcher scoring model.
const RESEARCH_COUNTRIES = new Set(["US", "GB", "CA", "AU"]);
export function aggregateResearchers(items) {
  const byHandle = new Map();
  const filtered = { country: 0, notEmployed: 0, openToWork: 0, noText: 0 };
  for (const p of items) {
    const handle = p.publicIdentifier;
    if (!handle || byHandle.has(handle)) continue;
    const cur = (p.currentPosition || [])[0] || null;
    const countryCode = p.location?.parsed?.countryCode || null;
    const headline = p.headline || "";
    const about = p.about || "";
    // Undergrad-graduation proxy: earliest education end year present
    const gradYears = (p.education || []).map((e) => e.endDate?.year).filter((y) => typeof y === "number");
    const gradYear = gradYears.length ? Math.min(...gradYears) : null;

    if (!countryCode || !RESEARCH_COUNTRIES.has(countryCode)) { filtered.country += 1; continue; }
    if (!cur) { filtered.notEmployed += 1; continue; }
    if (p.openToWork === true) { filtered.openToWork += 1; continue; }
    if (!headline && !about) { filtered.noText += 1; continue; }

    byHandle.set(handle, {
      handle,
      name: [p.firstName, p.lastName].filter(Boolean).join(" ") || handle,
      platform: "LinkedIn",
      profileUrl: p.linkedinUrl || `https://www.linkedin.com/in/${handle}`,
      headline,
      about,
      photo: p.profilePicture?.url || null,
      countryCode,
      company: cur.companyName || null,
      position: cur.position || null,
      employmentType: cur.employmentType || null,
      currentSince: cur.startDate?.year || null,
      gradYear,
      openToWork: Boolean(p.openToWork),
      connections: p.connectionsCount ?? null,
      followers: p.followerCount ?? null,
    });
  }
  return { candidates: [...byHandle.values()], filtered, uniqueProfiles: items.length };
}

// Account-level settings live in a named key-value store (created on first
// use, shared by every deployment and device) — per-user DM templates etc.
let settingsStoreIdCache = null;
// The settings store has existed since 2026-07-13 — reach it by known ID
// with a plain GET first. The create-or-get POST stays only as a fallback:
// during the Aug-2026 billing incident Apify blocked ALL creation POSTs
// ("Too many outstanding invoices") while reads/writes kept working, which
// silently took down the message bank and cursors.
const SETTINGS_STORE_ID = "7E31cmZncb6x6KDSg";
export async function getSettingsStoreId() {
  if (settingsStoreIdCache) return settingsStoreIdCache;
  try {
    const s = await apifyFetch(`/key-value-stores/${SETTINGS_STORE_ID}`);
    settingsStoreIdCache = s?.data?.id || SETTINGS_STORE_ID;
  } catch {
    const store = await apifyFetch(`/key-value-stores?name=casting-desk-settings`, { method: "POST" });
    settingsStoreIdCache = store?.data?.id || store?.id;
  }
  return settingsStoreIdCache;
}
export async function getSetting(key) {
  try { return await getRunRecord(await getSettingsStoreId(), key); } catch { return null; }
}
export async function setSetting(key, value) {
  try { await setRunRecord(await getSettingsStoreId(), key, value); } catch {}
}

// ── UGC creator sourcing ────────────────────────────────────────────────
// Country display-name → TikTok/LinkedIn country code.
export const COUNTRY_CODE = { "United States": "US", "United Kingdom": "GB", "Canada": "CA", "Australia": "AU" };

// Fixed pool of UGC-for-hire hashtags. We sample 8 per run and avoid the last
// run's set, so repeat runs cover fresh ground. NOTE: TikTok hashtag yield
// DECAYS run-over-run (finite standing stock of top posts) — LinkedIn
// pagination below is the steady weekly-volume engine.
export const UGC_POOL = [
  "ugccreator", "ugccommunity", "ugcportfolio", "ugcexample", "ugcads", "ugccontent",
  "contentcreatorforhire", "ugcjourney", "ugctips", "ugccreatorlife", "ugcforbrands",
  "freelancecreator", "ugcexamplevideo", "sparkads",
  // Tech-UGC slice — creators demoing apps/software/AI are an especially
  // strong fit for Anara (scoring gives them a bonus too).
  "techugc", "ugctech", "appdemo", "saasugc", "techcreator",
];
export function sampleUgcTags(avoid = [], n = 8) {
  const avoidSet = new Set(avoid);
  const fresh = UGC_POOL.filter((t) => !avoidSet.has(t));
  const pool = [...fresh, ...UGC_POOL.filter((t) => avoidSet.has(t))]; // prefer fresh, then allow repeats
  const out = [];
  const bag = [...pool];
  while (out.length < Math.min(n, UGC_POOL.length) && bag.length) {
    // Shuffle-pick from the fresh-first bag
    const idx = out.length < fresh.length ? Math.floor(Math.random() * Math.min(fresh.length, bag.length)) : Math.floor(Math.random() * bag.length);
    out.push(bag.splice(idx, 1)[0]);
  }
  return out;
}

// LinkedIn UGC-freelancer search (job title "UGC Creator" etc.). Walks the
// standing population page-by-page via a persisted cursor, so each weekly run
// finds NEW people. Freelancers/seniority are NOT excluded — they're the target.
export async function startUgcLinkedInRun({ countries, maxItems }) {
  const takePages = Math.max(1, Math.ceil(maxItems / 25));
  const cursor = (await getSetting("LI_UGC_CURSOR")) || {};
  const startPage = Math.max(1, cursor.startPage || 1);
  const input = {
    profileScraperMode: "Full",
    currentJobTitles: ["UGC Creator", "Content Creator", "Freelance Content Creator"],
    locations: countries,
    excludeCurrentJobTitles: ["Recruiter", "Talent Acquisition", "Agency Owner", "Marketing Manager", "Social Media Manager", "Head of", "Director"],
    maxItems,
    startPage,
    takePages,
  };
  const { data } = await apifyFetch(`/acts/${LI_ACTOR}/runs`, { method: "POST", body: JSON.stringify(input) });
  // Advance the cursor so the next run picks up where this one stopped.
  await setSetting("LI_UGC_CURSOR", { startPage: startPage + takePages, at: Date.now() });
  return { ...data, startPage, takePages };
}

// Same field mapping as researchers, but the only mechanical filters are
// country-in-selection and has-text (no employed-now / openToWork checks —
// freelancers are often self-employed and openToWork is a good sign here).
export function aggregateUgcLinkedIn(items, countryCodes = []) {
  const allow = new Set(countryCodes.length ? countryCodes : ["US", "GB"]);
  const byHandle = new Map();
  const filtered = { country: 0, noText: 0 };
  for (const p of items) {
    const handle = p.publicIdentifier;
    if (!handle || byHandle.has(handle)) continue;
    const cur = (p.currentPosition || [])[0] || null;
    const countryCode = p.location?.parsed?.countryCode || null;
    const headline = p.headline || "";
    const about = p.about || "";
    if (!countryCode || !allow.has(countryCode)) { filtered.country += 1; continue; }
    if (!headline && !about) { filtered.noText += 1; continue; }
    byHandle.set(handle, {
      handle,
      name: [p.firstName, p.lastName].filter(Boolean).join(" ") || handle,
      platform: "LinkedIn",
      profileUrl: p.linkedinUrl || `https://www.linkedin.com/in/${handle}`,
      headline,
      about,
      photo: p.profilePicture?.url || null,
      countryCode,
      company: cur?.companyName || null,
      position: cur?.position || null,
      employmentType: cur?.employmentType || null,
      currentSince: cur?.startDate?.year || null,
      gradYear: null,
      openToWork: Boolean(p.openToWork),
      connections: p.connectionsCount ?? null,
      followers: p.followerCount ?? null,
    });
  }
  return { candidates: [...byHandle.values()], filtered, uniqueProfiles: items.length };
}
