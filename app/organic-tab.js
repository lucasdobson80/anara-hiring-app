"use client";

import { useState } from "react";

// Organic scouting: creators Lucas finds himself while scrolling. Everything
// added here lands in Review with full stats — no score bar, a hand-pick
// always gets through, and pasting someone previously screened/rejected
// rescues them into the queue.

export default function OrganicTab({ onImported }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/source/manual", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      setResult(data);
      setText("");
      onImported?.();
    } catch (e) {
      setResult({ error: e.message });
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="card" style={{ padding: "20px 22px", marginBottom: 18 }}>
        <div className="eyebrow">ADD FROM ORGANIC SCROLLING</div>
        <p className="soft" style={{ fontSize: 13.5, margin: "8px 0 0", lineHeight: 1.6 }}>
          Paste everything you found this session — <b>TikTok, Instagram, or LinkedIn</b> profile links,
          video/reel links, or @handles, any mix, separated by new lines, spaces, or commas (up to 30 per
          batch). TikTok and Instagram get scraped for stats and scored for context; LinkedIn profiles go
          straight in as tracked bookmarks (no stats — you already judged them by eye). Everything lands
          in <b>Review</b>: no score bar here, and pasting someone the AI screened out rescues them.
        </p>
        <textarea
          className="input note-area"
          style={{ marginTop: 12, minHeight: 130 }}
          placeholder={"https://www.tiktok.com/@creator1\nhttps://www.instagram.com/creator2\nhttps://www.instagram.com/reel/ABC123  (reel links work too)\nhttps://www.linkedin.com/in/jane-doe\n@creator3"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button className="primary" onClick={add} disabled={busy || !text.trim()}>
            {busy ? "Scraping & scoring… ~1 min" : "Add to Review"}
          </button>
        </div>
        {result && !result.error && (
          <div className="banner" style={{ marginTop: 10, borderRadius: 10 }}>
            {result.added} added · {result.rescued} rescued from screened/rejected · {result.alreadyKnown} already in the pipeline
            {result.details?.filter((d) => d.alreadyKnown && d.owner && d.owner !== "lucas").map((d) => ` · @${d.handle} is in ${d.owner}'s pipeline`).join("")}
            {result.notFound?.length > 0 && ` · not found: ${result.notFound.join(", ")}`}
          </div>
        )}
        {result?.error && (
          <div className="banner bad" style={{ marginTop: 10, borderRadius: 10 }}>{result.error}</div>
        )}
      </div>

    </div>
  );
}
