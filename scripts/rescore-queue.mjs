// Re-score the current Review queue (Status=New) under the latest rubric.
// Bio/captions aren't stored in Notion, so the prior rationale is passed as
// context. Usage: node scripts/rescore-queue.mjs
import { Client } from "@notionhq/client";
import { readFileSync } from "node:fs";
import { scoreCandidates } from "../lib/scoring.js";
import { normHandle } from "../lib/notion.js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DS = "500d2766-e9c4-46e2-9f4a-64e606217dc7";
const plain = (rich) => (rich || []).map((t) => t.plain_text).join("");

let pages = [], cursor;
do {
  const res = await notion.dataSources.query({
    data_source_id: DS, page_size: 100, start_cursor: cursor,
    filter: { property: "Status", select: { equals: "New" } },
  });
  pages.push(...res.results);
  cursor = res.has_more ? res.next_cursor : undefined;
} while (cursor);

const candidates = pages.map((p) => ({
  page_id: p.id,
  handle: plain(p.properties?.Handle?.rich_text).replace(/^@/, ""),
  name: plain(p.properties?.Name?.title),
  followers: p.properties?.Followers?.number ?? null,
  maxViews: p.properties?.["Avg Views"]?.number ?? 0,
  email: p.properties?.Email?.email || null,
  signature: `(bio not stored — prior assessment: ${plain(p.properties?.Rationale?.rich_text).slice(0, 200)})`,
  sampleTexts: [],
  videoCount: 1,
  latestPost: null,
}));

console.log(`re-scoring ${candidates.length} queued candidates…`);
const { results } = await scoreCandidates(candidates, 70);

let changed = 0;
for (const c of candidates) {
  const s = results.get(normHandle(c.handle));
  if (!s) continue;
  const oldScore = pages.find((p) => p.id === c.page_id)?.properties?.Score?.number;
  await notion.pages.update({
    page_id: c.page_id,
    properties: {
      Score: { number: s.score },
      Rationale: { rich_text: [{ text: { content: `${s.rationale} (re-scored for reply likelihood)`.slice(0, 1900) } }] },
    },
  });
  changed++;
  console.log(`@${c.handle}: ${oldScore} → ${s.score}  (${c.followers ?? "?"} followers)`);
}
console.log(`\n${changed} re-scored.`);
