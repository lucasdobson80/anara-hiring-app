import { NextResponse } from "next/server";
import { createCreator, handleExists } from "@/lib/notion";
import { sendNotificationEmail } from "@/lib/apify";

export const dynamic = "force-dynamic";

// PUBLIC endpoint (middleware skips auth): the application intake behind
// /apply. Community owners share the form link with their members; each
// submission lands in the Review queue as Status=New with the community
// name stamped into the rationale for attribution.
//
// Abuse guards for a public writer: honeypot field, strict field caps, a
// parseable TikTok/Instagram profile, and dedupe against the whole DB.

const EMAIL_RX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function parseProfile(raw) {
  const s = String(raw || "").trim().slice(0, 300);
  const tt = s.match(/tiktok\.com\/@([A-Za-z0-9_.\-]+)/i);
  if (tt) return { platform: "TikTok", handle: tt[1].toLowerCase(), profileUrl: `https://www.tiktok.com/@${tt[1].toLowerCase()}` };
  const ig = s.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (ig && !["reel", "reels", "p", "tv", "explore", "stories"].includes(ig[1].toLowerCase())) {
    return { platform: "Instagram", handle: ig[1].toLowerCase(), profileUrl: `https://www.instagram.com/${ig[1].toLowerCase()}/` };
  }
  const at = s.match(/^@?([A-Za-z0-9_.]{2,30})$/);
  if (at) return { platform: "TikTok", handle: at[1].toLowerCase(), profileUrl: `https://www.tiktok.com/@${at[1].toLowerCase()}` };
  return null;
}

export async function POST(request) {
  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json({ error: "setup", message: "Applications are closed right now." }, { status: 503 });
  }
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "bad-request", message: "Invalid submission." }, { status: 400 });
  }
  // Honeypot: humans never see this field; bots fill it
  if (body.website) return NextResponse.json({ ok: true });

  const name = String(body.name || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().slice(0, 120);
  const portfolio = String(body.portfolio || "").trim().slice(0, 200);
  const country = String(body.country || "").trim().slice(0, 40);
  const AUDIENCES = ["College students", "Researchers & postgrads", "Don't mind"];
  const audience = AUDIENCES.includes(body.audience) ? body.audience : null;
  const community = String(body.community || "").trim().slice(0, 60).replace(/[^\w\s\-.]/g, "");
  const profile = parseProfile(body.link);

  if (name.length < 2) return NextResponse.json({ error: "bad-request", message: "Please enter your name." }, { status: 400 });
  if (!EMAIL_RX.test(email)) return NextResponse.json({ error: "bad-request", message: "Please enter a valid email." }, { status: 400 });
  if (!profile) return NextResponse.json({ error: "bad-request", message: "Please paste your TikTok or Instagram profile link (or @handle)." }, { status: 400 });

  // Notify Lucas on every application (awaited so serverless doesn't kill
  // it, but a mail hiccup must never fail the applicant's submission)
  const notify = async (headline) => {
    try {
      await sendNotificationEmail({
        subject: `${headline}: ${name} (@${profile.handle})`,
        text: [
          headline,
          "",
          `Name: ${name}`,
          `Profile: ${profile.profileUrl}`,
          `Platform: ${profile.platform}`,
          `Email: ${email}`,
          audience ? `Prefers: ${audience}` : null,
          country ? `Country: ${country}` : null,
          portfolio ? `Portfolio: ${portfolio}` : null,
          `Community: ${community || "(direct link)"}`,
          "",
          "Review: https://anara-casting-desk.vercel.app",
        ].filter(Boolean).join("\n"),
      });
    } catch {}
  };

  try {
    if (await handleExists(profile.handle, profile.platform)) {
      // Known handle (any stage, incl. screened) — friendly, no duplicate
      // row, but still worth knowing: a screened person applying is a signal
      await notify("Application from someone already in the pipeline");
      return NextResponse.json({ ok: true, alreadyKnown: true });
    }
    const rationale = [
      `📥 Applied via ${community || "intake form"}`,
      audience && audience !== "Don't mind" ? `prefers ${audience.toLowerCase()}` : null,
      country || null,
      portfolio ? `portfolio: ${portfolio}` : null,
    ].filter(Boolean).join(" · ");
    await createCreator(
      {
        handle: profile.handle,
        name,
        profileUrl: profile.profileUrl,
        email,
        followers: null,
        maxViews: null,
        score: null,
        rationale,
        niche: ["ugc", "applied"],
        platform: profile.platform,
      },
      "New", "lucas", "creator"
    );
    await notify("New UGC application");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "notion", message: "Something went wrong — please try again." }, { status: 502 });
  }
}
