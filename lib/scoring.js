import Anthropic from "@anthropic-ai/sdk";
import { normHandle } from "./notion.js";

const SCORING_MODEL = process.env.SCORING_MODEL || "claude-sonnet-5";

export function hasAnthropicKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Scoring philosophy (rewritten Jul 2026 per Lucas): the creator program now
// hires PROFESSIONAL UGC FREELANCERS only — people whose account/profile exists
// to sell their content-making — NOT study/lifestyle influencers. Calibrated on
// the 8 real hires (dedicated-UGC-account pattern in the handles). Follower
// counts are ignored entirely. {{COUNTRIES}} is the target-country list.
const UGC_PROMPT = `You screen TikTok and Instagram accounts for Anara's UGC creator program. Anara pays freelance UGC creators per video to make short promotional content on dedicated accounts. We are hiring PROFESSIONAL UGC FREELANCERS — people whose account exists to sell their content-creation services — NOT study, lifestyle, or general influencers. For reference, real hires look like: @ugcwithcamille, @techugcwithdijou, @danigreenugc, @ugcbykevinj, @enoracreative, @coltonwelgancreates — note the dedicated-UGC-account pattern (ugc / creates / creative / creator in the handle or name, and a bio selling UGC services).

Score 0-100:

1. DEDICATED UGC ACCOUNT SIGNALS (primary) — is this a for-hire content creator?
- Handle or display name contains "ugc", "creates", "creative", "creator", or "content".
- Bio sells UGC / content-creation services ("UGC creator", "content creator for brands", "collabs open", "DM for rates", "brand partnerships", "I make ads that convert").
- Portfolio link (beacons.ai, stan.store, linktr.ee, carrd), a business email, or explicit for-hire language.

2. AD-CRAFT — can they make good branded content?
- On-camera selling, hooks, product demos, unboxings, testimonial style, spec/example ads (infer from captions + bio).
- TECH BONUS: creators who demo apps / software / AI tools / gadgets (like @techugcwithdijou) are an especially strong fit — Anara is an AI product, so add roughly +5 for clear tech/app UGC content. A bonus only: general UGC freelancers (beauty, lifestyle products, food…) still fully qualify.

3. COUNTRY GATE — the target countries are: {{COUNTRIES}}.
- Judge country from bio, language, spelling, location cues, currency/brand mentions.
- If the account is CLEARLY based outside the target countries, hard_reject with reject_reason noting the country.
- If country is unknown but the content is in English, ALLOW (do not reject for a missing location).

IGNORE follower counts and views entirely — professional UGC creators keep small accounts on purpose; brands pay for content, not reach.

HARD REJECT (hard_reject=true):
- Accounts with NO for-hire / UGC signals at all — a study, lifestyle, or general influencer who is not advertising content-creation services is NOT who we hire now (this is the entire point of the search).
- Faceless meme / edit / slideshow / repost / fan accounts.
- Agencies or studios (we hire individuals, not companies).
- Anyone clearly based outside {{COUNTRIES}}.
- Promoters of competitor AI study tools (Studley AI, Oreate AI, Thea, Knowt, Turbo AI, fabric, SimpleStudy) or existing Anara ambassadors.

Calibration — {{THRESHOLD}}+ enters human review; lean generous on genuine for-hire creators. Reserve 85+ for an obvious dedicated-UGC account (for-hire bio + portfolio/email) with clear ad-craft in the target countries.

For each candidate return: handle (exactly as given), score, niche (always include "ugc"; add 1-2 content niches they demo, e.g. "beauty", "tech", "food", "fitness"), a 1-2 sentence rationale for the human reviewer (mention the for-hire signal and inferred country), hard_reject, and reject_reason (null unless hard_reject).`;

// LinkedIn-sourced UGC freelancers (found by the "UGC Creator" job title).
const UGC_LINKEDIN_PROMPT = `You screen LinkedIn profiles for Anara's UGC creator program. Anara pays freelance UGC creators per video to make short branded content. These profiles were found by the LinkedIn job titles "UGC Creator" / "Content Creator" — we want independent FREELANCE UGC creators available for brand work.

Target countries: {{COUNTRIES}} — judge from the profile's country/location.

Score 0-100 on whether this is a genuine freelance UGC / content creator available for brand work:
- HEADLINE / ABOUT / current role describe UGC or content creation for brands, a portfolio, rates, "UGC creator", "user-generated content", or freelance/self-employed content work.
- A portfolio, rate card, or "open to brand collaborations" language is a strong positive.
- "Open to work" / "available for freelance" is a POSITIVE here — freelancers advertising availability reply to outreach.
- TECH BONUS: freelancers whose UGC covers apps / software / SaaS / AI tools / gadgets are an especially strong fit — Anara is an AI product, so add roughly +5 for clear tech-content experience. A bonus only: general UGC freelancers still fully qualify.

HARD REJECT (hard_reject=true):
- Recruiters, talent acquisition, or agency owners.
- Brand-side / in-house marketing employees (Social Media Manager, Marketing Manager, Content Manager AT a company) whose job is marketing one employer's brand, not freelance content creation.
- Anyone clearly based outside {{COUNTRIES}}.
- Agencies or studios (we hire individuals).

Calibration — {{THRESHOLD}}+ enters human review; lean generous on clear freelance UGC creators.

For each candidate return: handle (exactly as given), score, niche (always include "ugc"; add content niches if evident), a 1-2 sentence rationale (mention the freelance/for-hire signal and country), hard_reject, and reject_reason (null unless hard_reject).`;

// One schema for every path — niche is a free-string tag array.
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
          niche: { type: "array", items: { type: "string" } },
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

const CURRENT_YEAR = new Date().getFullYear();
const RESEARCHER_PROMPT = `You screen LinkedIn profiles as candidates for Anara's UGC program aimed at INDUSTRY RESEARCHERS. Anara (anara.com) is an AI workspace for students, grad students, and researchers. These candidates would make short videos about Anara from a working-professional angle, so we want early-career people in pharma / biotech / CRO (contract research organization) roles who are comfortable presenting themselves.

Target ROLE FAMILIES (their current job should be one of these or clearly adjacent): Clinical Research Associate / Clinical Trial Assistant / Clinical Research Coordinator, Medical Science Liaison, Medical Writer / Regulatory Writer, Regulatory Affairs Associate/Specialist, Pharmacovigilance / Drug Safety Associate, Research Associate / Scientist I / Lab Scientist, Medical Affairs Associate, Clinical Data Manager / Associate, Industry Pharmacist (PharmD in industry), Research Nurse / Clinical Nurse in biotech, Biomedical Engineer, QA/QC Associate in pharma.

INDUSTRY CHECK: judge from the company name + position + about whether the employer is genuinely pharma, biotech, or a CRO (e.g. Fortrea, IQVIA, Parexel, ICON, Labcorp, Pfizer, AstraZeneca, small biotechs). A researcher at a hospital, university lab, unrelated company, or a marketing/comms agency does NOT count.

HARD REJECT (hard_reject=true) when the profile is clearly:
- a recruiter, talent acquisition, sourcer, or agency/staffing person (even if pharma keywords appear),
- a consultant, freelancer, or self-employed / "Self-employed" contractor,
- clearly SENIOR — Director, Head, VP, Principal, or "Senior" with many years in role,
- employed somewhere that is NOT pharma/biotech/CRO,
- a student, "aspiring", "seeking opportunities", or currently unemployed.

SCORE 0-100, higher is better:
- UNDERGRAD GRADUATION YEAR is an age proxy (younger preferred): ${CURRENT_YEAR - 6} or later is ideal (roughly under 29); 2015-2018 a mild minus; earlier a stronger minus; unknown a small minus.
- Currently EMPLOYED full-time in one of the target roles at a real pharma/biotech/CRO: strong positive.
- A well-written HEADLINE and ABOUT section (they present themselves clearly — they'll be on camera): positive. Sparse/empty about: minus.
- Recognizable CRO/pharma employer: small positive.

Calibration — {{THRESHOLD}}+ enters human review; a human reviews everyone who clears the bar, so lean slightly generous on borderline early-career in-role candidates. Reserve 85+ for a clearly early-career (grad ${CURRENT_YEAR - 6}+), currently-employed, well-presented candidate at an obvious pharma/biotech/CRO in a core role (esp. Medical Writer / Regulatory / Clinical Research).

For each candidate return: handle (exactly as given), score, niche (a one or two word role slug like "medical-writer", "clinical-research", "regulatory", "pharmacovigilance"), a 1-2 sentence rationale for the human reviewer (mention role, employer, and grad year), hard_reject, and reject_reason (null unless hard_reject).`;

// Scraped TikTok text sometimes contains lone UTF-16 surrogate halves
// (mangled emoji). Serialized into an API request they make the JSON body
// invalid ("no low surrogate in string") and the whole chunk 400s forever —
// strip them before anything downstream sees the text.
const stripLoneSurrogates = (s) =>
  typeof s === "string" ? s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "") : s;

function candidateBlock(raw) {
  const c = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.map(stripLoneSurrogates) : stripLoneSurrogates(v)])
  );
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

function researcherBlock(raw) {
  const c = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? stripLoneSurrogates(v) : v])
  );
  return [
    `handle: ${c.handle}`,
    `name: ${c.name}`,
    `headline: ${c.headline || "(none)"}`,
    `current role: ${c.position || "(unknown)"}${c.company ? ` at ${c.company}` : ""}${c.employmentType ? ` (${c.employmentType})` : ""}${c.currentSince ? ` since ${c.currentSince}` : ""}`,
    `about: ${(c.about || "(none)").slice(0, 700)}`,
    `undergrad graduation year (proxy): ${c.gradYear ?? "unknown"}`,
    `country: ${c.countryCode || "unknown"}`,
    `connections: ${c.connections ?? "unknown"}`,
  ].join("\n");
}

export async function scoreCandidates(candidates, threshold = 73, { researcher = false, ugcLinkedIn = false, countries = [] } = {}) {
  const anthropic = client();
  const CHUNK = 20;
  const results = new Map();
  let usage = { input_tokens: 0, output_tokens: 0 };

  const countryList = countries?.length ? countries.join(", ") : "United States, United Kingdom";
  const prompt = researcher ? RESEARCHER_PROMPT : ugcLinkedIn ? UGC_LINKEDIN_PROMPT : UGC_PROMPT;
  const system = prompt.replaceAll("{{THRESHOLD}}", String(threshold)).replaceAll("{{COUNTRIES}}", countryList);
  const schema = SCORE_SCHEMA;
  // LinkedIn candidates (researcher or UGC-freelancer) share the profile block;
  // TikTok/IG accounts use the account block.
  const block = researcher || ugcLinkedIn ? researcherBlock : candidateBlock;

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const response = await anthropic.messages.create({
      model: SCORING_MODEL,
      max_tokens: 8000,
      system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: `Score these ${chunk.length} candidates:\n\n${chunk.map(block).join("\n---\n")}`,
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
