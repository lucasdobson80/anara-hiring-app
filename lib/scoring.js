import Anthropic from "@anthropic-ai/sdk";
import { normHandle } from "@/lib/notion";

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
const ICP_PROMPT = `You score TikTok creators as candidates for Anara's UGC creator program. Anara (anara.com) is an AI workspace that helps students, grad students, and researchers find, understand, and write papers. Creators are paid per video to post about Anara on dedicated new accounts — so what matters most is whether they can MAKE COMPELLING SHORT VIDEOS, not only which niche they currently post in.

Score 0-100 across two dimensions:

1. CREATOR SKILL (primary):
- Views-to-follower ratio on the best sourced video is the main measurable skill signal (2x+ is strong, 10x+ is exceptional).
- On-camera presence: creators who appear and talk in their videos (day-in-my-life, storytime, GRWM, vlogs, talking-head advice) are far more valuable than faceless accounts (meme edits, slideshows, quote pages, fan accounts). Infer this from the bio and captions.
- Several videos in this scrape with coherent captions suggests consistency.

2. AUDIENCE FIT (a boost, not a gate):
- Ideal: study, academia, grad school, PhD, productivity, note-taking.
- Strong: students and young professionals broadly — student life, university lifestyle, tech, career, self-improvement.
- Acceptable: general lifestyle with a young-adult audience, when creator skill is high.
- Weak: audiences that would never touch a research tool (gaming clips, pets, faceless meme pages).

Calibration — 73+ enters human review:
- A skilled on-camera lifestyle/tech/student creator with a strong ratio should score 74-84 even with zero study angle.
- Reserve 85+ for strong skill AND study/academic audience fit.
- Low-engagement accounts (well under ~1x ratio) or faceless accounts should rarely clear 73 regardless of niche.

HARD REJECT (hard_reject=true): promotion of competitor AI study tools (Studley AI, Oreate AI, Thea, Knowt, Turbo AI, fabric, SimpleStudy), existing Anara ambassadors, or clearly faceless meme/edit/fan accounts.

For each candidate return: handle (exactly as given), score, niche tags, a 1-2 sentence rationale for the human reviewer (mention the on-camera signal and the ratio), hard_reject, and reject_reason (null unless hard_reject).`;

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
            items: { type: "string", enum: ["study", "academia", "productivity", "student life", "lifestyle", "tech", "other"] },
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
  return [
    `handle: ${c.handle}`,
    `display name: ${c.name}`,
    `bio: ${c.signature || "(none)"}`,
    `followers: ${c.followers ?? "unknown"}`,
    `best sourced video views: ${c.maxViews}`,
    `videos in this scrape: ${c.videoCount}`,
    `latest post: ${c.latestPost || "unknown"}`,
    `sample captions: ${c.sampleTexts.join(" | ") || "(none)"}`,
  ].join("\n");
}

export async function scoreCandidates(candidates) {
  const anthropic = client();
  const CHUNK = 20;
  const results = new Map();
  let usage = { input_tokens: 0, output_tokens: 0 };

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const response = await anthropic.messages.create({
      model: SCORING_MODEL,
      max_tokens: 8000,
      system: ICP_PROMPT,
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
    resultsPerPage: { type: "integer" },
    days: { type: "integer" },
    maxItems: { type: "integer" },
    note: { type: "string" },
  },
  required: ["hashtags", "resultsPerPage", "days", "maxItems", "note"],
  additionalProperties: false,
};

export async function parseBrief(brief) {
  const anthropic = client();
  const response = await anthropic.messages.create({
    model: SCORING_MODEL,
    max_tokens: 1000,
    system: `You configure TikTok hashtag scrapes for sourcing UGC creators for Anara (an AI workspace for students, grad students, and researchers). Given a brief, propose hashtags (no # prefix, lowercase, 3-10 of them), resultsPerPage (videos per hashtag, default 60), days (recency window, default 30), and maxItems (total result cap, default 500, never above 1500). The proven set for study-focused runs is: studytok, studytips, studywithme, gradschool, phdlife, gradstudent, thesis, academia. Anara also recruits skilled general creators, so lifestyle/tech/career/student-life briefs are valid targets — pick hashtags where creators appear on camera (e.g. dayinmylife, grwm, storytime, techtok, careertok, unilife) rather than faceless meme/edit tags. In "note", one sentence on your reasoning. The scraper cannot filter by country or follower count — if the brief asks for that, choose hashtags that skew toward it and say in the note that the rest is handled at scoring.`,
    output_config: { format: { type: "json_schema", schema: CONFIG_SCHEMA } },
    messages: [{ role: "user", content: brief }],
  });
  if (response.stop_reason === "refusal") throw new Error("Request was refused by the model");
  const text = response.content.find((b) => b.type === "text")?.text;
  return JSON.parse(text);
}
