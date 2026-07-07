"use client";

import { useState, useEffect } from "react";

// Organic scouting: creators Lucas finds himself while scrolling. Everything
// added here lands in Review with full stats — no score bar, a hand-pick
// always gets through, and pasting someone previously screened/rejected
// rescues them into the queue.

const LOG_KEY = "cd_organic_log";
const readLog = () => { try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; } };
const writeLog = (log) => { try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 100))); } catch {} };

const fmt = (n) => (n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
const fmtDay = (ts) => {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export default function OrganicTab({ onImported }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);

  useEffect(() => { setLog(readLog()); }, []);

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
      // Log only creators actually added/rescued — not ones already known
      const logged = (data.details || []).filter((d) => !d.alreadyKnown);
      if (logged.length) {
        const at = Date.now();
        const next = [...logged.map((d) => ({ ...d, at })), ...readLog()];
        writeLog(next);
        setLog(next.slice(0, 100));
      }
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
          Paste everything you found this session — <b>TikTok or Instagram</b> profile links, video/reel
          links, or @handles, any mix, separated by new lines, spaces, or commas (up to 30 per batch).
          Each one is scraped for stats and scored for context, then added straight to <b>Review</b>.
          Your picks always get through — no score bar here, and pasting someone the AI screened out
          rescues them.
        </p>
        <textarea
          className="input note-area"
          style={{ marginTop: 12, minHeight: 130 }}
          placeholder={"https://www.tiktok.com/@creator1\nhttps://www.instagram.com/creator2\nhttps://www.instagram.com/reel/ABC123  (reel links work too)\n@creator3"}
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

      <div className="eyebrow" style={{ marginBottom: 8 }}>SCOUTING LOG</div>
      {log.length === 0 && (
        <p className="soft" style={{ fontSize: 13.5 }}>
          Nothing scouted yet on this device — your adds will appear here with their scores.
        </p>
      )}
      <div className="runs">
        {log.map((e, i) => (
          <div key={`${e.handle}-${e.at}-${i}`} className="call-row">
            <span className={"mini-stamp mono" + (e.score == null ? " miss-stamp" : "")}>{e.score ?? "–"}</span>
            <a className="browse-name" style={{ flex: 1 }} href={(e.platform === "Instagram" ? "https://www.instagram.com/" : "https://www.tiktok.com/@") + String(e.handle).replace(/^@/, "")} target="_blank" rel="noreferrer">
              @{String(e.handle).replace(/^@/, "")} ↗
            </a>
            <span className="mono soft" style={{ fontSize: 11.5 }}>{e.platform === "Instagram" ? "IG" : "TT"}</span>
            <span className="mono soft" style={{ fontSize: 12 }}>{fmt(e.followers)} followers</span>
            {e.email && <span className="mono soft" style={{ fontSize: 12 }}>✉</span>}
            {e.rescued && <span className="badge" style={{ color: "#3ECF8E", borderColor: "rgba(62,207,142,.4)" }}>rescued</span>}
            <span className="mono soft" style={{ fontSize: 11.5 }}>{fmtDay(e.at)}</span>
          </div>
        ))}
      </div>
      <p className="hint">
        The log lives on this device and is just your trail — the creators themselves are in Review and Notion.
        Tip: on your phone, share a TikTok video → Copy link, then paste a whole session&apos;s worth here at once.
      </p>
    </div>
  );
}
