// Audit a run's scoring without inserting anything: prints the score
// distribution and the top near-misses. Usage: node scripts/score-audit.mjs <runId>
import { getRun, getDatasetItems, aggregateCandidates } from "../lib/apify.js";
import { scoreCandidates } from "../lib/scoring.js";
import { fetchAllCreators } from "../lib/notion.js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const run = await getRun(process.argv[2]);
const items = await getDatasetItems(run.defaultDatasetId);
const { candidates } = aggregateCandidates(items, { days: 30 });
const known = new Set((await fetchAllCreators()).map((c) => (c.handle || "").toLowerCase().replace(/^@/, "")));
const fresh = candidates.filter((c) => !known.has(c.handle.toLowerCase().replace(/^@/, "")));
console.log(`scoring ${fresh.length} fresh candidates…`);
const { results } = await scoreCandidates(fresh);
const scores = [...results.values()].filter((s) => !s.hard_reject).sort((a, b) => b.score - a.score);
const buckets = {};
for (const s of scores) { const b = Math.floor(s.score / 10) * 10; buckets[b] = (buckets[b] || 0) + 1; }
console.log("distribution:", Object.entries(buckets).sort((a, b) => b[0] - a[0]).map(([b, n]) => `${b}s: ${n}`).join("  "));
console.log("\ntop 6:");
for (const s of scores.slice(0, 6)) console.log(` ${s.score}  ${s.handle}  ${s.niche.join("/")}  — ${s.rationale.slice(0, 100)}`);
