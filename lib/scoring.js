import Anthropic from "@anthropic-ai/sdk";

const SCORING_MODEL = process.env.SCORING_MODEL || "claude-sonnet-5";

export function hasAnthropicKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ICP rules from the validated sourcing playbook — keep in sync with the
// mechanical pre-filters in lib/apify.js (those handle followers/recency/language).
const ICP_PROMPT = `You score TikTok creators as candidates for Anara's UGC program. Anara (anara.com) helps grad students and researchers find, understand, and write papers faster. Creators post videos about Anara on dedicated accounts and are paid per video.

Scoring rules (0-100):
- Ideal niches: study, academia, grad school, PhD, productivity, student life. Postgrad-leaning content is the strongest fit.
- A strong views-to-follower ratio is the main skill signal (views here are the best-performing sourced video, not a profile average).
- Sweet spot is 1k-60k followers; 60k-150k is acceptable but weaker.
- Generic lifestyle content with no study angle scores low.
- HARD REJECT (set hard_reject=true) if the bio or video text shows promotion of competitor AI study tools (e.g. Studley AI, Oreate AI, Thea, Knowt, Turbo AI, fabric, SimpleStudy) or an existing Anara ambassadorship.
- 73+ means "worth a human review". Reserve 85+ for clearly excellent fits.

For each candidate return: handle (exactly as given), score, niche tags, a 1-2 sentence rationale written for the human reviewer, hard_reject, and reject_reason (null unless hard_reject).`;

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
            items: { type: "string", enum: ["study", "academia", "productivity", "student life", "lifestyle", "other"] },
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
    const text = response.content.find((b) => b.type === "text")?.text;
    const parsed = JSON.parse(text);
    for (const s of parsed.scores) results.set(s.handle.toLowerCase(), s);
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
    system: `You configure TikTok hashtag scrapes for sourcing UGC creators for Anara (an AI tool for grad students/researchers). Given a brief, propose hashtags (no # prefix, lowercase, 3-10 of them), resultsPerPage (videos per hashtag, default 60), days (recency window, default 30), and maxItems (total result cap, default 500, never above 1500). The default hashtag set for general runs is: studytok, studytips, studywithme, gradschool, phdlife, gradstudent, thesis, academia. Adapt it to the brief. In "note", one sentence on your reasoning. Note the scraper cannot filter by country or follower count - if the brief asks for that, choose hashtags that skew toward it and say in the note that the rest is handled at scoring.`,
    output_config: { format: { type: "json_schema", schema: CONFIG_SCHEMA } },
    messages: [{ role: "user", content: brief }],
  });
  if (response.stop_reason === "refusal") throw new Error("Request was refused by the model");
  const text = response.content.find((b) => b.type === "text")?.text;
  return JSON.parse(text);
}
