// One-time: add an "Email" property to the Creator Sourcing Pipeline
// database. Usage: node scripts/add-email-property.mjs
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
  properties: { Email: { email: {} } },
});
console.log("Email property added.");
