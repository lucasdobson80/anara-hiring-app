// Promote Screened creators whose score clears a (newly lowered) bar back
// into the Review queue. Hard rejects stay screened.
// Usage: node scripts/promote-screened.mjs [threshold=70]
import { Client } from "@notionhq/client";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const threshold = parseInt(process.argv[2], 10) || 70;
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DS = "500d2766-e9c4-46e2-9f4a-64e606217dc7";

let results = [], cursor;
do {
  const r = await notion.dataSources.query({
    data_source_id: DS, page_size: 100, start_cursor: cursor,
    filter: { property: "Status", select: { equals: "Screened" } },
  });
  results.push(...r.results);
  cursor = r.has_more ? r.next_cursor : undefined;
} while (cursor);

let promoted = 0;
for (const p of results) {
  const score = p.properties?.Score?.number ?? 0;
  const rationale = (p.properties?.Rationale?.rich_text || []).map((t) => t.plain_text).join("");
  if (score >= threshold && !rationale.startsWith("HARD REJECT")) {
    const handle = (p.properties?.Handle?.rich_text || []).map((t) => t.plain_text).join("");
    await notion.pages.update({ page_id: p.id, properties: { Status: { select: { name: "New" } } } });
    console.log(`promoted ${handle} (score ${score})`);
    promoted++;
  }
}
console.log(`\n${results.length} screened rows checked, ${promoted} promoted to New at bar ${threshold}`);
