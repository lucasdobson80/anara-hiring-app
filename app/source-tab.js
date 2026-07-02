"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const DEFAULT_HASHTAGS = "studytok, studytips, studywithme, gradschool, phdlife, gradstudent, thesis, academia";

// Candidate-yield forecast, calibrated on real imports (Jul 2026: ~4-5% of
// scraped videos survive pre-filters, dedupe, and the 73+ score threshold).
// Yield decays as the database grows, hence a range rather than a number.
const YIELD_LOW = 0.03;
const YIELD_HIGH = 0.08;
const REVIEWS_PER_DAY = 25; // Lucas's target review pace (20-30/day)

// The yield forecast only holds for study-adjacent hashtags — warn when the
// set drifts off-ICP (a generic run can yield literally zero candidates).
const ICP_HASHTAG_HINT = /stud|grad|phd|thesis|academ|school|student|uni|college|exam|revision|nurs|med|law|productiv|note|learn/i;
const offIcpShare = (tags) => tags.length === 0 ? 0 : tags.filter((t) => !ICP_HASHTAG_HINT.test(t)).length / tags.length;

const fmtUsd = (n) => (n == null ? "–" : `$${n.toFixed(2)}`);
const fmtWhen = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

export default function SourceTab({ onImported }) {
  const [status, setStatus] = useState(null); // { ready, spend, runs, estPerResult }
  const [error, setError] = useState(null);
  const [hashtags, setHashtags] = useState(DEFAULT_HASHTAGS);
  const [resultsPerPage, setResultsPerPage] = useState(60);
  const [days, setDays] = useState(30);
  const [maxItems, setMaxItems] = useState(500);
  const [brief, setBrief] = useState("");
  const [briefNote, setBriefNote] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [importing, setImporting] = useState(null); // runId
  const [importResult, setImportResult] = useState(null);
  const pollRef = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/source/status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      setStatus(data);
      setError(null);
      return data;
    } catch (e) {
      setError("Couldn't reach Apify: " + e.message);
      return null;
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Poll while any run is still going
  useEffect(() => {
    const hasActive = status?.runs?.some((r) => ["RUNNING", "READY"].includes(r.status));
    clearInterval(pollRef.current);
    if (hasActive) pollRef.current = setInterval(loadStatus, 20000);
    return () => clearInterval(pollRef.current);
  }, [status, loadStatus]);

  const parsedHashtags = hashtags.split(",").map((h) => h.replace(/^#/, "").trim()).filter(Boolean);
  // Videos actually returned = whichever is smaller: what the hashtags can
  // yield, or the hard cap. Cost and candidate forecasts both flow from it.
  const expVideos = Math.min(parsedHashtags.length * (parseInt(resultsPerPage, 10) || 0), parseInt(maxItems, 10) || 0);
  const estCost = status ? (expVideos * status.estPerResult).toFixed(2) : null;
  const candLow = Math.max(1, Math.round(expVideos * YIELD_LOW));
  const candHigh = Math.round(expVideos * YIELD_HIGH);
  const fmtDays = (n) => (n < 0.75 ? "under a day" : n < 1.5 ? "about a day" : `~${Math.round(n)} days`);
  const reviewLoad = candHigh > 0 ? `${fmtDays(candLow / REVIEWS_PER_DAY)}–${fmtDays(candHigh / REVIEWS_PER_DAY)}`.replace(/^(.*)–\1$/, "$1") : null;

  const draftFromBrief = async () => {
    if (!brief.trim()) return;
    setParsing(true); setBriefNote(null);
    try {
      const res = await fetch("/api/source/parse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      setHashtags(data.hashtags.join(", "));
      setResultsPerPage(data.resultsPerPage);
      setDays(data.days);
      setMaxItems(data.maxItems);
      setBriefNote(data.note);
    } catch (e) {
      setBriefNote("Couldn't draft a config: " + e.message);
    } finally { setParsing(false); }
  };

  const launch = async () => {
    setLaunching(true); setImportResult(null);
    try {
      const res = await fetch("/api/source/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashtags: parsedHashtags, resultsPerPage, days, maxItems }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      await loadStatus();
    } catch (e) {
      setError("Couldn't launch the run: " + e.message);
    } finally { setLaunching(false); }
  };

  const importRun = async (runId) => {
    setImporting(runId); setImportResult(null);
    try {
      const res = await fetch("/api/source/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, days }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      setImportResult(data);
      onImported?.();
    } catch (e) {
      setImportResult({ error: e.message });
    } finally { setImporting(null); }
  };

  if (!status && !error) return <div className="empty">Loading sourcing status…</div>;

  if (status && !status.ready.apify) return (
    <div className="empty card">
      <div className="empty-title">Connect Apify to source from here</div>
      <div className="soft" style={{ maxWidth: 520, margin: "10px auto 0", lineHeight: 1.6 }}>
        Add <span className="mono">APIFY_TOKEN</span> to the environment (Apify Console → Settings →
        API &amp; Integrations → copy your personal token) and reload. Scoring also needs{" "}
        <span className="mono">ANTHROPIC_API_KEY</span>.
      </div>
    </div>
  );

  return (
    <div className="source">
      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      {status?.spend && (
        <div className="spendbar">
          <div>
            <div className="eyebrow">APIFY SPEND THIS CYCLE</div>
            <div className="spend-num mono">
              {fmtUsd(status.spend.monthlyUsageUsd)}
              {status.spend.maxMonthlyUsageUsd != null && (
                <span className="soft"> / {fmtUsd(status.spend.maxMonthlyUsageUsd)} plan limit</span>
              )}
            </div>
          </div>
          <button className="ghost" onClick={loadStatus}>Refresh</button>
        </div>
      )}

      <div className="card" style={{ padding: "20px 22px", marginBottom: 16 }}>
        <div className="eyebrow">NEW SOURCING RUN</div>

        <div className="nl-row">
          <input
            className="input"
            placeholder='Describe a run, e.g. "nursing students, smaller accounts, last 2 weeks"…'
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") draftFromBrief(); }}
            disabled={!status.ready.anthropic}
          />
          <button className="ghost" onClick={draftFromBrief} disabled={parsing || !status.ready.anthropic}>
            {parsing ? "Drafting…" : "Draft config"}
          </button>
        </div>
        {!status.ready.anthropic && (
          <p className="hint" style={{ marginTop: 4 }}>
            Natural-language drafting and scoring need <span className="mono">ANTHROPIC_API_KEY</span> — the form and launch still work.
          </p>
        )}
        {briefNote && <p className="soft" style={{ fontSize: 13, margin: "6px 0 0" }}>{briefNote}</p>}

        <div className="fields">
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Hashtags</span>
            <input className="input" value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
          </label>
          <label className="field">
            <span>Videos per hashtag</span>
            <input className="input" type="number" value={resultsPerPage} onChange={(e) => setResultsPerPage(e.target.value)} />
          </label>
          <label className="field">
            <span>Active within (days)</span>
            <input className="input" type="number" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label className="field">
            <span>Max total results</span>
            <input className="input" type="number" value={maxItems} onChange={(e) => setMaxItems(e.target.value)} />
          </label>
        </div>

        <div className="forecast">
          <div className="eyebrow">RUN FORECAST (ESTIMATE)</div>
          <div className="forecast-line">
            <b className="mono">{expVideos}</b> videos from {parsedHashtags.length} hashtags
            <span className="soft"> → </span>
            <b className="mono">≈{candLow}–{candHigh}</b> new candidates in your Review queue
            <span className="soft"> → </span>
            {reviewLoad} of review at {REVIEWS_PER_DAY}/day
          </div>
          <p className="soft" style={{ fontSize: 12, margin: "4px 0 0" }}>
            Based on your real import history (~3–8% of videos survive filtering, dedupe, and the 73+ score bar).
            Yield drops as your database grows — re-running the same hashtags finds fewer new faces.
          </p>
          {offIcpShare(parsedHashtags) > 0.5 && (
            <p className="off-icp-warn">
              ⚠ Most of these hashtags look outside the study/academia niche — the forecast above won&apos;t hold,
              and yield could be near zero. Generic tags (lifestyle, travel, content…) scrape the wrong crowd.
            </p>
          )}
        </div>

        <div className="launch-row">
          <span className="soft" style={{ fontSize: 13 }}>
            scrape cost ~${estCost} <span className="mono" style={{ fontSize: 11 }}>(estimate)</span> + a few cents of scoring
          </span>
          <button className="primary" onClick={launch} disabled={launching || !parsedHashtags.length}>
            {launching ? "Launching…" : "Launch run"}
          </button>
        </div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 8 }}>RECENT RUNS</div>
      {(!status.runs || status.runs.length === 0) && <p className="soft" style={{ fontSize: 13.5 }}>No runs yet.</p>}
      <div className="runs">
        {status.runs?.map((r) => (
          <div key={r.id} className="run-row">
            <span className={"badge run-" + r.status.toLowerCase()}>{r.status}</span>
            <span className="mono soft run-meta">{fmtWhen(r.startedAt)} · {r.usageUsd != null ? fmtUsd(r.usageUsd) : "cost pending"}</span>
            {r.status === "SUCCEEDED" && (
              <button className="ghost small" onClick={() => importRun(r.id)} disabled={importing !== null}>
                {importing === r.id ? "Scoring… (takes a minute)" : "Import & score"}
              </button>
            )}
          </div>
        ))}
      </div>

      {importResult && !importResult.error && (
        <>
          <div className="banner" style={{ marginTop: 14, borderRadius: 10 }}>
            Imported: {importResult.inserted} new candidates added to the queue ·{" "}
            {importResult.videosFetched} videos → {importResult.uniqueCreators} creators ·{" "}
            {importResult.alreadyKnown} already in the database · {importResult.hardRejected} hard-rejected ·{" "}
            {importResult.belowThreshold} below threshold
            {importResult.insertFailures?.length > 0 && ` · ${importResult.insertFailures.length} failed to insert`}
          </div>
          {importResult.inserted === 0 && importResult.topMisses?.length > 0 && (
            <div className="misses">
              <div className="eyebrow">NOTHING CLEARED THE BAR — CLOSEST MISSES</div>
              {importResult.topMisses.map((m) => (
                <div key={m.handle} className="miss-row">
                  <span className="mini-stamp mono miss-stamp">{m.score}</span>
                  <span className="mono">{m.handle}</span>
                  <span className="soft miss-why">{m.rationale}</span>
                </div>
              ))}
              <p className="soft" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                When even the best scores are far below 73, the hashtags usually pointed outside the
                study/academia niche — try a run closer to the proven set.
              </p>
            </div>
          )}
        </>
      )}
      {importResult?.error && (
        <div className="banner bad" style={{ marginTop: 14, borderRadius: 10 }}>Import failed: {importResult.error}</div>
      )}
      <p className="hint">
        A run takes a few minutes on Apify&apos;s side — this list refreshes itself while one is going. When it shows
        SUCCEEDED, hit Import &amp; score: candidates are filtered, scored against the ICP, deduped against the whole
        database, and anyone scoring {`≥73`} lands in Review as New.
      </p>
    </div>
  );
}
