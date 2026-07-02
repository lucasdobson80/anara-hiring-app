# Anara Casting Desk

Creator sourcing + onboarding cockpit for Anara's UGC program. A stateless
front-end over the Notion **"Creator Sourcing Pipeline"** database — Notion
stays the single source of truth.

Rebuilt from the validated Claude-artifact prototype, replacing LLM-mediated
Notion access with direct Notion API calls (sub-second loads instead of
20–60s, no token limits, no rate-limit retries).

## Views

- **Review** — judge Status=New candidates one by one (keyboard: `A` approve,
  `R` reject, `U` undo) or browse the whole queue. Decisions batch locally;
  one Save writes them all to Notion.
- **Onboard** — everyone past review (Approved → Signed), each with a
  stage-aware playbook: company-mandated DM/interview/contract/IG/email copy
  and links, all one click to copy.
- **Funnel rail** — live counts per stage.

## Setup

1. `nvm use --lts` (or any Node ≥ 20), then `npm install`
2. Create an internal integration at https://www.notion.so/my-integrations
3. In Notion, open the Creator Sourcing Pipeline database → `•••` →
   Connections → add the integration (share only this database with it)
4. Put the integration secret in `.env.local` as `NOTION_TOKEN`
5. `npm run dev` → http://localhost:3000

## Architecture notes

- All Notion calls happen in server routes ([app/api](app/api)); the token is
  never exposed client-side.
- `PATCH /api/pages` updates pages sequentially (Notion has no batch endpoint)
  and reports per-page failures; the client keeps failed decisions queued so
  Save retries only those.
- Company copy lives verbatim in [lib/templates.js](lib/templates.js) — do not
  reword without company sign-off.
- TikTok can't be embedded; profile links always open in new tabs.

## Out of scope for v1 (by design)

Instagram sourcing, multi-user auth, DM auto-sending (banned — manual send is
a company mandate), analytics beyond funnel counts, in-app scraping. The
weekly Apify sourcing run (`clockworks/tiktok-scraper` → ICP scoring → Notion
insert) stays a separate scheduled job.
