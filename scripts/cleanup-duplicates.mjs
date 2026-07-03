// One-time cleanup of duplicate creator rows created by concurrent imports.
// Groups rows by canonical handle; keeps the copy with the furthest-along
// status (human decisions beat automated ones), archives the rest to Notion's
// trash (recoverable for 30 days). Usage: node scripts/cleanup-duplicates.mjs
import { Client } from "@notionhq/client";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DS = "500d2766-e9c4-46e2-9f4a-64e606217dc7";
// Furthest-along wins; Screened is the least interesting copy
const RANK = ["Signed", "Trial", "Interview", "Replied", "Contacted", "Approved", "New", "Rejected", "Screened"];
const rank = (s) => { const i = RANK.indexOf(s); return i === -1 ? RANK.length : i; };
const norm = (h) => String(h || "").toLowerCase().replace(/^@/, "").trim();

let results = [], cursor;
do {
  const r = await notion.dataSources.query({ data_source_id: DS, page_size: 100, start_cursor: cursor });
  results.push(...r.results);
  cursor = r.has_more ? r.next_cursor : undefined;
} while (cursor);

const groups = new Map();
for (const p of results) {
  const key = norm((p.properties?.Handle?.rich_text || []).map((t) => t.plain_text).join(""));
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({
    id: p.id,
    status: p.properties?.Status?.select?.name || "New",
    created: p.created_time,
  });
}

let archivedCount = 0, groupCount = 0;
for (const [handle, rows] of groups) {
  if (rows.length < 2) continue;
  groupCount++;
  rows.sort((a, b) => rank(a.status) - rank(b.status) || a.created.localeCompare(b.created));
  const keep = rows[0];
  for (const row of rows.slice(1)) {
    await notion.pages.update({ page_id: row.id, archived: true });
    archivedCount++;
  }
  console.log(`${handle}: kept ${keep.status}, archived ${rows.length - 1}`);
}
console.log(`\ndone: ${groupCount} duplicate groups, ${archivedCount} rows archived (Notion trash, recoverable 30 days)`);
