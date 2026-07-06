// One-time: add an "Owner" select property to the Creator Sourcing Pipeline
// and set every existing row to "lucas". Usage: node scripts/add-owner-property.mjs
import { Client } from "@notionhq/client";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DS = "500d2766-e9c4-46e2-9f4a-64e606217dc7";

await notion.dataSources.update({
  data_source_id: DS,
  properties: {
    Owner: {
      select: { options: [{ name: "lucas", color: "blue" }, { name: "laia", color: "green" }, { name: "alba", color: "orange" }] },
    },
  },
});
console.log("Owner property added.");

let pages = [], cursor;
do {
  const res = await notion.dataSources.query({ data_source_id: DS, page_size: 100, start_cursor: cursor });
  pages.push(...res.results);
  cursor = res.has_more ? res.next_cursor : undefined;
} while (cursor);

let set = 0;
for (const p of pages) {
  if (p.properties?.Owner?.select?.name) continue;
  await notion.pages.update({ page_id: p.id, properties: { Owner: { select: { name: "lucas" } } } });
  set++;
}
console.log(`backfilled ${set} rows → owner "lucas".`);
