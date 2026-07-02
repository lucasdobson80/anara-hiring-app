import { Client } from "@notionhq/client";

const DATA_SOURCE_ID =
  process.env.NOTION_DATA_SOURCE_ID || "500d2766-e9c4-46e2-9f4a-64e606217dc7";

export function notionClient() {
  if (!process.env.NOTION_TOKEN) return null;
  return new Client({ auth: process.env.NOTION_TOKEN });
}

// ---- property readers (tolerant of empty values) ----
const plain = (rich) => (rich || []).map((t) => t.plain_text).join("");

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

export async function createCreator(c) {
  const notion = notionClient();
  const rt = (s) => (s ? [{ text: { content: String(s).slice(0, 1900) } }] : []);
  await notion.pages.create({
    parent: { data_source_id: DATA_SOURCE_ID },
    properties: {
      Name: { title: [{ text: { content: c.name || c.handle } }] },
      Handle: { rich_text: rt(c.handle.startsWith("@") ? c.handle : `@${c.handle}`) },
      Platform: { select: { name: "TikTok" } },
      "Profile Link": { url: c.profileUrl },
      Followers: { number: c.followers ?? null },
      "Avg Views": { number: c.maxViews ?? null },
      Score: { number: c.score },
      Rationale: { rich_text: rt(c.rationale) },
      Niche: { multi_select: (c.niche || []).map((n) => ({ name: n })) },
      "Date Sourced": { date: { start: new Date().toISOString().slice(0, 10) } },
      Status: { select: { name: "New" } },
    },
  });
}

export async function updateStatus(pageId, status) {
  const notion = notionClient();
  await notion.pages.update({
    page_id: pageId,
    properties: { Status: { select: { name: status } } },
  });
}
