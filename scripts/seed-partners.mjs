// One-time: seed the Partners track with the curated community targets from
// the 30 Jul 2026 discovery scrape (Skool / Whop / TikTok coach accounts).
// Rows: Track=partner, Status=Approved ("Found"), rationale starts with
// "Owner: <name>" — the playbook parses that for the {name} pitch token.
import { Client } from "@notionhq/client";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const DS = "500d2766-e9c4-46e2-9f4a-64e606217dc7";
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// name, handle, platform, link, members, email, ownerNote
const TARGETS = [
  ["UGC World", "gloria-stonelake", "Web", "https://www.skool.com/ugc-world", 15200, null, "Owner: Gloria Stonelake · 15,200 members · Free · #1 free UGC community; she has done UGC for Perplexity AI (gets AI tools). Also runs UGC Academy — one conversation covers both."],
  ["UGC Foundations Masterclass", "baotran-tran", "Web", "https://www.skool.com/tran-ugc-foundations", 1000, null, "Owner: Baotran Tran · 1,000 members · $70/mo · 7k+ alumni; has an internal brand-deal marketplace — your opportunity belongs in it."],
  ["UGC Creator Collective", "georgie-danks", "Web", "https://www.skool.com/ugc-creator-collective-7887", 656, null, "Owner: Georgie Danks · 656 members · Free · also runs an agency shipping creatives monthly."],
  ["UGC Creator Network", "sociallyaziz", "TikTok", "https://www.tiktok.com/@sociallyaziz", 416, "contact@sociallyaziz.com", "Owner: Salha Aziz · 416 members · $499 · Skool: skool.com/ugccreatornetwork · cross-confirmed TikTok @sociallyaziz (26.9k). Canadian coach."],
  ["UGC Hive", "jackie-mccue", "Web", "https://www.skool.com/ugc-hive", 318, null, "Owner: Jackie McCue · 318 members · Free · UK-FOCUSED — core target country."],
  ["UGC Academy", "gloria-stonelake-academy", "Web", "https://www.skool.com/ugcacademy", 302, null, "Owner: Gloria Stonelake · 302 members · invite-only · same owner as UGC World."],
  ["Software UGC", "quintin-ford", "Web", "https://www.skool.com/softwareugc", 90, null, "Owner: Quintin Ford · 90 members · $299 · software-niche UGC — ideal Anara creator profile."],
  ["Nyomi's UGC Community", "ugcwithnyomi", "TikTok", "https://www.tiktok.com/@ugcwithnyomi", 58500, null, "Owner: Nyomi · free Skool community (skool.com/nyomis-free-ugc-community-4758) · TikTok 58.5k · Europe-focused."],
  ["Creator Life", "creator-life", "Web", "https://www.skool.com/creator-life", null, null, "Owner: unknown · UGC + creative strategist Skool community."],
  ["The Ultimate UGC + Content Hub", "ugc-mastery", "Web", "https://www.skool.com/ugc-mastery-2131", null, null, "Owner: unknown · step-by-step UGC Skool community."],
  ["iDoUGC Creator Network", "idougc", "Web", "https://whop.com/creator-vault-b50d", null, null, "Owner: iDoUGC team · Whop network distributing PAID BRIEFS from brands to creators — pitch Anara as a brief, they exist to carry offers like this."],
  ["Launchd UGC Community", "launchd", "Web", "https://whop.com/launchd", null, null, "Owner: Launchd team · 6-week UGC accelerator on Whop — graduates are trained and portfolio-ready."],
  ["Ang's UGC Course", "ugcang", "TikTok", "https://www.tiktok.com/@ugcang", 137500, "partnerships@ugcang.com", "Owner: Ang · 137.5k TikTok · runs a UGC course; has a partnerships inbox — expects offers."],
  ["UGC with Rach", "ugc.withrach", "TikTok", "https://www.tiktok.com/@ugc.withrach", 78900, "hello@ugcwithrach.com", "Owner: Rachel Martinez · 78.9k TikTok · 6-figure UGC business + waitlist community."],
  ["A+ Socials", "aplussocials", "TikTok", "https://www.tiktok.com/@aplussocials", 77900, "anna@aplussocials.com", "Owner: Anna · 77.9k TikTok · US coach, 'no BS UGC advice'."],
  ["UGC Fasttrack", "marziaprince", "TikTok", "https://www.tiktok.com/@marziaprince", 77500, null, "Owner: Marzia Prince · 77.5k TikTok · 1000+ students taught."],
  ["UGC Pro", "ugcpro.studio", "TikTok", "https://www.tiktok.com/@ugcpro.studio", 59600, null, "Owner: Kelly · 59.6k TikTok · 'trusted by 17,900+ creators', coaches the coaches."],
  ["Kyndhal Coaching", "kyndhalugc", "TikTok", "https://www.tiktok.com/@kyndhalugc", 38400, "contact@kyndhalugc.com", "Owner: Kyndhal · 38.4k TikTok · creator coach with talent-management ties."],
  ["Dani's UGC Guide", "daniellesmktguide", "TikTok", "https://www.tiktok.com/@daniellesmktguide", 28400, null, "Owner: Dani · 28.4k TikTok (+31k alt account) · UGC coach."],
  ["She's That Girl Co", "sophia.vinasco", "TikTok", "https://www.tiktok.com/@sophia.vinasco", 4911, "svinasco@shesthatgirl.co", "Owner: Sophia Vinasco · 1st female-centric TECH UGC agency; runs free creator masterclasses — perfect niche fit."],
  ["Be UGC", "itsmemomboss", "TikTok", "https://www.tiktok.com/@itsmemomboss", 418, null, "Owner: Patricia Streff · leads 'the largest UGC immigrant creators community', founder of Be UGC."],
  ["Starling Creative", "starlingcreative", "TikTok", "https://www.tiktok.com/@starlingcreative", 10400, null, "Owner: Jen · 10.4k TikTok · midlife (45+) creator niche."],
  ["Becky's UGC Masterclass", "beckyfeigin", "TikTok", "https://www.tiktok.com/@beckyfeigin", 3811, "becky@beckyfeiginugc.com", "Owner: Becky Feigin · runs a UGC masterclass."],
  ["Castle UGC", "nickcastlecreates", "TikTok", "https://www.tiktok.com/@nickcastlecreates", 6577, "nick@castleugc.com", "Owner: Nick Castle · UGC mentor, LA."],
  ["Tech with Elena", "techwithelena", "TikTok", "https://www.tiktok.com/@techwithelena", 1873, null, "Owner: Elena · tech UGC creator + AI educator — small but exactly on-niche."],
];

// Existing handles (all tracks) so re-runs never duplicate
const existing = new Set();
let cursor;
do {
  const r = await notion.dataSources.query({ data_source_id: DS, start_cursor: cursor, page_size: 100 });
  for (const p of r.results) {
    const h = p.properties?.Handle?.rich_text?.[0]?.plain_text || "";
    const plat = p.properties?.Platform?.select?.name || "TikTok";
    if (h) existing.add(`${plat}:${h.replace(/^@/, "").toLowerCase()}`);
  }
  cursor = r.has_more ? r.next_cursor : undefined;
} while (cursor);
console.log(`existing rows indexed: ${existing.size}`);

let added = 0, skipped = 0;
for (const [name, handle, platform, link, members, email, note] of TARGETS) {
  if (existing.has(`${platform}:${handle.toLowerCase()}`)) { skipped++; console.log(`skip (exists): ${name}`); continue; }
  await notion.pages.create({
    parent: { data_source_id: DS },
    properties: {
      Name: { title: [{ text: { content: name } }] },
      Handle: { rich_text: [{ text: { content: `@${handle}` } }] },
      Platform: { select: { name: platform } },
      "Profile Link": { url: link },
      Followers: { number: members },
      Score: { number: null },
      Rationale: { rich_text: [{ text: { content: `🤝 ${note}` } }] },
      Email: { email: email },
      Owner: { select: { name: "lucas" } },
      Track: { select: { name: "partner" } },
      Niche: { multi_select: [{ name: "partner" }] },
      "Date Sourced": { date: { start: new Date().toISOString().slice(0, 10) } },
      Status: { select: { name: "Approved" } },
    },
  });
  added++;
  console.log(`added: ${name}`);
}
console.log(`done — ${added} added, ${skipped} skipped`);
