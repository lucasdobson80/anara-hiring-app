import Anthropic from "@anthropic-ai/sdk";
import { normHandle } from "./notion.js";

const SCORING_MODEL = process.env.SCORING_MODEL || "claude-sonnet-5";

export function hasAnthropicKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Scoring philosophy (updated Jul 2026 per Lucas): creator SKILL is the
// primary signal — Anara recruits beyond the study niche. Audience fit is a
// boost, not a gate. Mechanical pre-filters in lib/apify.js still handle
// followers/recency/language before anything reaches this prompt.
const ICP_PROMPT = `You score TikTok and Instagram creators as candidates for Anara's UGC creator program. Anara (anara.com) is an AI workspace that helps students, grad students, and researchers find, understand, and write papers. Creators are paid per video to post about Anara on dedicated new accounts — so what matters most is whether they can MAKE COMPELLING SHORT VIDEOS, not only which niche they currently post in. "Views" below means TikTok video views or Instagram reel plays; judge the ratio the same way for both.

Score 0-100 across three dimensions:

1. CREATOR SKILL (primary):
- Views-to-follower ratio on the best sourced video is the main measurable skill signal (2x+ is strong, 10x+ is exceptional).
- On-camera presence: creators who appear and talk in their videos (day-in-my-life, storytime, GRWM, vlogs, talking-head advice) are far more valuable than faceless accounts (meme edits, slideshows, quote pages, fan accounts). Infer this from the bio and captions.
- Several videos in this scrape with coherent captions suggests consistency.

2. AUDIENCE FIT (a boost, not a gate):
- Ideal: study, academia, grad school, PhD, productivity, note-taking.
- Strong: students and young professionals broadly — student life, university lifestyle, tech, career, self-improvement.
- Acceptable: general lifestyle with a young-adult audience, when creator skill is high.
- Weak: audiences that would never touch a research tool (gaming clips, pets, faceless meme pages).

3. REPLY LIKELIHOOD (this program lives or dies on creators answering a cold DM/email):
- PRIMARY TARGET: 500-15,000 followers. Small creators making good content are hungriest for paid work and actually read their messages — when the skill is there, score them UP.
- 15k-30k: fine, no adjustment.
- Above ~30k: apply a soft penalty that grows with size (roughly -5 at 30k up to -15 at 100k) — they get brand offers weekly and rarely join a pay-per-video program. Only exceptional skill should still clear the bar.
- Agency/management email in the bio: around -10 — a gatekeeper reads the outreach, not the creator.
- A personal email (gmail/outlook/icloud) in the bio is a mild positive: they're inviting business contact.

Calibration — {{THRESHOLD}}+ enters human review. Lean generous: a human reviews everyone who clears the bar, so a borderline skilled creator should be seen rather than silently dropped.
- A skilled on-camera creator at 800-15k followers with a decent ratio (around 1x or better) should clear the bar even with zero study angle.
- Do NOT reward follower count itself — reward skill, then adjust for reply likelihood as above.
- Reserve 85+ for strong skill AND study/academic audience fit AND the primary size band.
- Only faceless accounts or clearly weak engagement (well under ~0.5x ratio with nothing else going for them) belong under the bar.

HARD REJECT (hard_reject=true): promotion of competitor AI study tools (Studley AI, Oreate AI, Thea, Knowt, Turbo AI, fabric, SimpleStudy), existing Anara ambassadors, or clearly faceless meme/edit/fan accounts.

For each candidate return: handle (exactly as given), score, niche tags (include "ugc" when the candidate shows for-hire signals), a 1-2 sentence rationale for the human reviewer (mention the on-camera signal and the ratio), hard_reject, and reject_reason (null unless hard_reject).`;

const UGC_MODE_ADDENDUM = `

UGC HUNT MODE — these candidates were sourced from UGC-for-hire hashtags (working UGC creators seeking brand work):
- IGNORE follower counts and views-to-follower ratios entirely. Working UGC creators keep small, low-engagement main accounts on purpose — brands pay them for content, not reach. Apply NO size penalty and NO ratio penalty in either direction.
- Score on AD-CRAFT instead: evidence of spec ads / example ads / portfolio pieces, hooks, on-camera selling, product-demo skill (infer from captions, bio, and video texts).
- FOR-HIRE SIGNALS are the main reply predictor: "UGC" in bio or name, portfolio link (Beacons/Stan Store/Linktree), business email, "collabs open". A candidate with clear for-hire signals AND competent on-camera ad content should comfortably clear {{THRESHOLD}}.
- Tag every candidate showing for-hire signals with the "ugc" niche tag.
- Hard-reject rules are unchanged (competitor study tools, Anara ambassadors, faceless accounts).`;

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          handle: { type: "string" },
          score: { type: "integer" },
          niche: {
            type: "array",
            items: { type: "string", enum: ["study", "academia", "productivity", "student life", "lifestyle", "tech", "ugc", "other"] },
          },
          rationale: { type: "string" },
          hard_reject: { type: "boolean" },
          reject_reason: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["handle", "score", "niche", "rationale", "hard_reject", "reject_reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["scores"],
  additionalProperties: false,
};

function candidateBlock(c) {
  const agency = c.email && /talent|manage|agency|mgmt|media|group|partners/i.test(c.email);
  return [
    `handle: ${c.handle}`,
    `display name: ${c.name}`,
    `bio: ${c.signature || "(none)"}`,
    `email in bio: ${c.email ? c.email + (agency ? " (looks like an agency/management address)" : " (personal)") : "(none)"}`,
    `for-hire signals: ${(c.ugcSignals || []).join(", ") || "(none)"}`,
    `followers: ${c.followers ?? "unknown"}`,
    `best sourced video views: ${c.maxViews}`,
    `videos in this scrape: ${c.videoCount}`,
    `latest post: ${c.latestPost || "unknown"}`,
    `sample captions: ${c.sampleTexts.join(" | ") || "(none)"}`,
  ].join("\n");
}

export async function scoreCandidates(candidates, threshold = 73, { ugcMode = false } = {}) {
  const anthropic = client();
  const CHUNK = 20;
  const results = new Map();
  let usage = { input_tokens: 0, output_tokens: 0 };

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const response = await anthropic.messages.create({
      model: SCORING_MODEL,
      max_tokens: 8000,
      system: (ICP_PROMPT + (ugcMode ? UGC_MODE_ADDENDUM : "")).replaceAll("{{THRESHOLD}}", String(threshold)),
      output_config: { format: { type: "json_schema", schema: SCORE_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Score these ${chunk.length} candidates:\n\n${chunk.map(candidateBlock).join("\n---\n")}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      throw new Error("Scoring request was refused by the model");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("Scoring response was truncated (max_tokens) — chunk too large");
    }
    const text = response.content.find((b) => b.type === "text")?.text;
    const parsed = JSON.parse(text);
    // Key by canonical handle so a model echoing "@foo" or "Foo " still matches
    for (const s of parsed.scores) results.set(normHandle(s.handle), s);
    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
  }
  return { results, usage };
}

// Turn a natural-language sourcing brief into a run config for the form.
const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    hashtags: { type: "array", items: { type: "string" } },
    searchQueries: { type: "array", items: { type: "string" } },
    resultsPerPage: { type: "integer" },
    days: { type: "integer" },
    maxItems: { type: "integer" },
    minFollowers: { type: "integer" },
    maxFollowers: { type: "integer" },
    note: { type: "string" },
  },
  required: ["hashtags", "searchQueries", "resultsPerPage", "days", "maxItems", "minFollowers", "maxFollowers", "note"],
  additionalProperties: false,
};

const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          searchQueries: { type: "array", items: { type: "string" } },
          minFollowers: { type: "integer" },
          maxFollowers: { type: "integer" },
          rationale: { type: "string" },
        },
        required: ["title", "hashtags", "searchQueries", "minFollowers", "maxFollowers", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

// Propose fresh run configs based on what past runs already covered and
// yielded — the antidote to re-scraping the same creators.
export async function suggestRuns(history) {
  const anthropic = client();
  const response = await anthropic.messages.create({
    model: SCORING_MODEL,
    max_tokens: 2500,
    system: `You plan TikTok scraping runs for sourcing UGC creators for Anara (an AI workspace for students, grad students, and researchers). Anara recruits creators who are good on camera with real content experience, mid-size to nano (500-100k followers) — big influencers won't join a pay-per-video program.

You are given the recent run history: hashtags/search terms used and what each yielded. Propose exactly 3 NEW run configs that avoid re-scraping the same ground:
1. "Double down" — a variation on whatever yielded best (adjacent long-tail tags, not identical ones).
2. "Fresh niche" — an audience the history hasn't touched yet (e.g. language learning, med school, law, engineering, creative students, career switchers, postgrad abroad).
3. "Nano hunt" — long-tail, low-competition hashtags where 500-5k creators actually rank (niche + specific, e.g. alevelrevision, weekinmylifeuni, firstyearuni), with minFollowers 500 and maxFollowers 5000.

Rules: never repeat a hashtag from the history in suggestions 2 and 3 (suggestion 1 may keep at most 2). Prefer tags where creators appear on camera. 4-8 hashtags plus 1-3 search phrases each. Titles under 5 words. Rationale: one sentence on why this ground is promising and untouched.`,
    output_config: { format: { type: "json_schema", schema: SUGGEST_SCHEMA } },
    messages: [{ role: "user", content: history }],
  });
  if (response.stop_reason === "refusal") throw new Error("Request was refused by the model");
  const text = response.content.find((b) => b.type === "text")?.text;
  return JSON.parse(text);
}

export async function parseBrief(brief) {
  const anthropic = client();
  const response = await anthropic.messages.create({
    model: SCORING_MODEL,
    max_tokens: 1000,
    system: `You configure TikTok scrapes for sourcing UGC creators for Anara (an AI workspace for students, grad students, and researchers). Given a brief, propose: hashtags (no # prefix, lowercase, 3-10), searchQueries (0-4 natural phrases like "day in my life uni student" — these reach creators hashtag top-posts miss; use them whenever the brief describes a person rather than a topic), resultsPerPage (videos per hashtag/query, default 60), days (recency window, default 30), maxItems (total cap, default 500, never above 1500), minFollowers (default 1000) and maxFollowers (default 100000 — the program pays per video, so very large influencers aren't interested; keep the band mid-size unless the brief says otherwise). The proven study set is: studytok, studytips, studywithme, gradschool, phdlife, gradstudent, thesis, academia. Lifestyle/tech/career/student-life briefs are valid targets — pick hashtags where creators appear on camera (dayinmylife, grwm, storytime, techtok, careertok, unilife) rather than faceless meme/edit tags. In "note", one sentence on your reasoning. The scraper cannot filter by country — if the brief asks, choose geo-skewed hashtags and say the rest is handled at scoring.`,
    output_config: { format: { type: "json_schema", schema: CONFIG_SCHEMA } },
    messages: [{ role: "user", content: brief }],
  });
  if (response.stop_reason === "refusal") throw new Error("Request was refused by the model");
  const text = response.content.find((b) => b.type === "text")?.text;
  return JSON.parse(text);
}
