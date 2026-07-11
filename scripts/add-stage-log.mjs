// One-time: add a "Stage Log" rich-text property (powers weekly metrics).
import { Client } from "@notionhq/client";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const notion = new Client({ auth: process.env.NOTION_TOKEN });
await notion.dataSources.update({
  data_source_id: "500d2766-e9c4-46e2-9f4a-64e606217dc7",
  properties: { "Stage Log": { rich_text: {} } },
});
console.log("Stage Log property added.");
