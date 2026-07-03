// Backfill the Email property for creators already in Notion, using bios
// from recent Apify run datasets. Usage: node scripts/backfill-emails.mjs
import { Client } from "@notionhq/client";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const APIFY = process.env.APIFY_TOKEN;
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DS = "500d2766-e9c4-46e2-9f4a-64e606217dc7";
const ACTOR = "clockworks~tiktok-scraper";
const norm = (h) => String(h || "").toLowerCase().replace(/^@/, "").trim();
const emailRx = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const af = (p) => fetch(`https://api.apify.com/v2${p}`, { headers: { Authorization: `Bearer ${APIFY}` } }).then((r) => r.json());

// Build handle -> email map from recent run datasets
const runs = (await af(`/acts/${ACTOR}/runs?desc=true&limit=15`)).data.items;
const emailByHandle = new Map();
for (const r of runs) {
  if (!r.defaultDatasetId) continue;
  const items = await af(`/datasets/${r.defaultDatasetId}/items?clean=true&limit=1000&fields=authorMeta`);
  for (const it of items || []) {
    const a = it.authorMeta || {};
    if (!a.name) continue;
    const e = (String(a.signature || "").match(emailRx) || [])[0];
    if (e && !emailByHandle.has(norm(a.name))) emailByHandle.set(norm(a.name), e);
  }
}
console.log(`bios with emails found across runs: ${emailByHandle.size}`);

// Update Notion rows that have no email yet
let pages = [], cursor;
do {
  const res = await notion.dataSources.query({ data_source_id: DS, page_size: 100, start_cursor: cursor });
  pages.push(...res.results);
  cursor = res.has_more ? res.next_cursor : undefined;
} while (cursor);

let updated = 0;
for (const p of pages) {
  if (p.properties?.Email?.email) continue;
  const handle = norm((p.properties?.Handle?.rich_text || []).map((t) => t.plain_text).join(""));
  const email = emailByHandle.get(handle);
  if (email) {
    await notion.pages.update({ page_id: p.id, properties: { Email: { email } } });
    updated++;
  }
}
console.log(`backfilled ${updated} creators with an email`);
