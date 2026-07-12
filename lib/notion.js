import { Client } from "@notionhq/client";

const DATA_SOURCE_ID =
  process.env.NOTION_DATA_SOURCE_ID || "500d2766-e9c4-46e2-9f4a-64e606217dc7";

export function notionClient() {
  if (!process.env.NOTION_TOKEN) return null;
  return new Client({ auth: process.env.NOTION_TOKEN });
}

// Canonical handle form used everywhere dedupe happens: no @, no case, no
// stray whitespace. Both the scraper side and the Notion side go through this.
export const normHandle = (h) => String(h || "").toLowerCase().replace(/^@/, "").trim();

// ---- property readers (tolerant of empty values) ----
const plain = (rich) => (rich || []).map((t) => t.plain_text).join("");

// "2026-07-06 → Contacted" lines stamped by updateStatus — the raw material
// for weekly funnel metrics.
function parseStageLog(text) {
  const events = [];
  for (const m of String(text || "").matchAll(/(\d{4}-\d{2}-\d{2}) → ([A-Za-z]+)/g)) {
    events.push({ date: m[1], status: m[2] });
  }
  return events;
}

function readProps(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: plain(p["Name"]?.title) || null,
    handle: plain(p["Handle"]?.rich_text) || null,
    platform: p["Platform"]?.select?.name || null,
    link: p["Profile Link"]?.url || null,
    followers: p["Followers"]?.number ?? null,
    views: p["Avg Views"]?.number ?? null,
    score: p["Score"]?.number ?? null,
    rationale: plain(p["Rationale"]?.rich_text) || null,
    notes: plain(p["Notes"]?.rich_text) || null,
    email: p["Email"]?.email || null,
    niche: (p["Niche"]?.multi_select || []).map((n) => n.name),
    dateSourced: p["Date Sourced"]?.date?.start || null,
    stageEvents: parseStageLog(plain(p["Stage Log"]?.rich_text)),
    owner: p["Owner"]?.select?.name || null,
    status: p["Status"]?.select?.name || null,
    lastEdited: page.last_edited_time,
  };
}

export async function fetchAllCreators() {
  const notion = notionClient();
  const results = [];
  let cursor;
  do {
    const res = await notion.dataSources.query({
      data_source_id: DATA_SOURCE_ID,
      page_size: 100,
      start_cursor: cursor,
      sorts: [{ property: "Score", direction: "descending" }],
    });
    results.push(...res.results.map(readProps));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

// Targeted existence check used as the last line of defence against
// concurrent imports inserting the same creator twice. Matches the handle
// with and without the "@" prefix (older rows vary).
export async function handleExists(handle, platform = "TikTok") {
  const notion = notionClient();
  const bare = normHandle(handle);
  const res = await notion.dataSources.query({
    data_source_id: DATA_SOURCE_ID,
    page_size: 3,
    filter: {
      or: [
        { property: "Handle", rich_text: { equals: `@${bare}` } },
        { property: "Handle", rich_text: { equals: bare } },
      ],
    },
  });
  // Same @handle can be a different person on another platform — only a
  // same-platform match counts as a duplicate.
  return res.results.some((p) => (p.properties?.Platform?.select?.name || "TikTok") === platform);
}

// status "New" enters the review queue; status "Screened" records creators
// the AI scored below the bar — invisible in the app, but permanently known
// to dedupe so nobody is ever scraped-and-scored twice.
export async function createCreator(c, status = "New", owner = "lucas") {
  const notion = notionClient();
  // Lone surrogate halves in scraped text break API JSON bodies — strip them
  const cl = (s) => String(s).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  const rt = (s) => (s ? [{ text: { content: cl(s).slice(0, 1900) } }] : []);
  await notion.pages.create({
    parent: { data_source_id: DATA_SOURCE_ID },
    properties: {
      Name: { title: [{ text: { content: cl(c.name || c.handle) } }] },
      Handle: { rich_text: rt(c.handle.startsWith("@") ? c.handle : `@${c.handle}`) },
      Platform: { select: { name: c.platform || "TikTok" } },
      "Profile Link": { url: c.profileUrl },
      Followers: { number: c.followers ?? null },
      "Avg Views": { number: c.maxViews ?? null },
      Score: { number: c.score },
      Rationale: { rich_text: rt(c.rationale) },
      Email: { email: c.email || null },
      Owner: { select: { name: owner } },
      Niche: { multi_select: (c.niche || []).map((n) => ({ name: n })) },
      "Date Sourced": { date: { start: new Date().toISOString().slice(0, 10) } },
      Status: { select: { name: status } },
    },
  });
}

// Append a timestamped note to a creator's Notes property, preserving what's
// already there (Notion rich_text: max ~100 items / 2000 chars each).
export async function appendNote(pageId, note) {
  const notion = notionClient();
  const page = await notion.pages.retrieve({ page_id: pageId });
  const prop = page.properties?.Notes;
  let items = prop?.rich_text || [];
  // pages.retrieve truncates rich_text at 25 items — fetch the full property
  // when we might be at that limit, or the write-back would drop old notes.
  if (items.length >= 25 && prop?.id) {
    items = [];
    let cursor;
    do {
      const r = await notion.pages.properties.retrieve({
        page_id: pageId, property_id: prop.id, page_size: 100, start_cursor: cursor,
      });
      items.push(...r.results.map((x) => x.rich_text));
      cursor = r.has_more ? r.next_cursor : undefined;
    } while (cursor);
  }
  const existing = items
    .map((t) => ({ text: { content: t.plain_text } }))
    .slice(-90);
  const stamp = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const prefix = existing.length ? "\n" : "";
  const addition = { text: { content: `${prefix}[${stamp} call] ${note}`.slice(0, 1900) } };
  await notion.pages.update({
    page_id: pageId,
    properties: { Notes: { rich_text: [...existing, addition] } },
  });
}

export async function updateStatus(pageId, status) {
  const notion = notionClient();
  // Stamp the transition so weekly metrics can be computed later. Read the
  // existing log first (short property — the 25-item retrieve cap is far away).
  let existing = [];
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    existing = (page.properties?.["Stage Log"]?.rich_text || []).map((t) => ({ text: { content: t.plain_text } }));
  } catch {}
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `${existing.length ? "\n" : ""}${stamp} → ${status}`;
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: status } },
      "Stage Log": { rich_text: [...existing.slice(-40), { text: { content: line } }] },
    },
  });
}
