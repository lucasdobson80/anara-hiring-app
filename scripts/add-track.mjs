// One-time: add a "Track" select property (creator | researcher) so the app
// can run two separate pipelines over one Notion DB, then backfill every
// existing row to "creator".
import { Client } from "@notionhq/client";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const DS = "500d2766-e9c4-46e2-9f4a-64e606217dc7";
const notion = new Client({ auth: process.env.NOTION_TOKEN });

await notion.dataSources.update({
  data_source_id: DS,
  properties: {
    Track: { select: { options: [{ name: "creator", color: "blue" }, { name: "researcher", color: "purple" }] } },
  },
});
console.log("Track property added.");

let cursor, seen = 0, filled = 0;
do {
  const res = await notion.dataSources.query({ data_source_id: DS, page_size: 100, start_cursor: cursor });
  for (const page of res.results) {
    seen += 1;
    if (page.properties?.Track?.select) continue; // already set — don't clobber
    await notion.pages.update({ page_id: page.id, properties: { Track: { select: { name: "creator" } } } });
    filled += 1;
  }
  cursor = res.has_more ? res.next_cursor : undefined;
} while (cursor);
console.log(`Backfill done: ${filled} of ${seen} rows set to creator.`);
