"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const DEFAULT_HASHTAGS = "studytok, studytips, studywithme, gradschool, phdlife, gradstudent, thesis, academia";

// One-click niche rotation — fresh hashtag sets are what produce genuinely
// new creators day after day; re-running the same set mostly re-finds the
// same top posts.
const PRESETS = {
  "Study": DEFAULT_HASHTAGS,
  "Student life": "unilife, collegelife, dormlife, freshman, studentlife, uniday, campuslife, backtouni",
  "Lifestyle": "dayinmylife, grwm, morningroutine, storytime, weekinmylife, vlog, thatgirl, resetroutine",
  "Tech & career": "techtok, careertok, internship, corporatelife, 9to5, codinglife, worklife, firstjob",
  "Med & nursing": "medschool, medstudent, nursingschool, nursingstudent, premed, futuredoctor, scrublife, medtok",
};

// Candidate-yield forecast, calibrated on real imports (Jul 2026: ~4-5% of
// scraped videos survive pre-filters, dedupe, and the 73+ score threshold).
// Yield decays as the database grows, hence a range rather than a number.
const YIELD_LOW = 0.03;
const YIELD_HIGH = 0.08;
const REVIEWS_PER_DAY = 25; // Lucas's target review pace (20-30/day)

// Anara recruits skilled creators beyond the study niche, but hashtags that
// suggest faceless/meme/edit content (or audiences far from students and
// young professionals) still tank the yield — nudge before spend.
const ICP_HASHTAG_HINT = /stud|grad|phd|thesis|academ|school|student|uni|college|exam|revision|nurs|med|law|productiv|note|learn|lifestyle|tech|career|vlog|grwm|dayin|storytime|selfimprove|routine|desk/i;
const offIcpShare = (tags) => tags.length === 0 ? 0 : tags.filter((t) => !ICP_HASHTAG_HINT.test(t)).length / tags.length;

// Client-side run memory (single-user app): which runs are archived, which
// were imported and what they yielded, and which we launched and should
// auto-import on completion.
const store = {
  read(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } },
  write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

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
  const [searchTerms, setSearchTerms] = useState("");
  const [resultsPerPage, setResultsPerPage] = useState(60);
  const [days, setDays] = useState(30);
  const [maxItems, setMaxItems] = useState(500);
  const [minFollowers, setMinFollowers] = useState(1000);
  const [maxFollowers, setMaxFollowers] = useState(100000);
  const [threshold, setThreshold] = useState(70);
  const [brief, setBrief] = useState("");
  const [briefNote, setBriefNote] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [importing, setImporting] = useState(null); // runId
  const [importResult, setImportResult] = useState(null);
  const [archived, setArchived] = useState({});
  const [imports, setImports] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const launchedRef = useRef({});
  // Synchronous in-flight guard: React state updates too late to stop the
  // auto-import effect and a manual click starting the same import together.
  const importInFlightRef = useRef(false);
  const pollRef = useRef(null);

  useEffect(() => {
    setArchived(store.read("cd_runs_archived"));
    setImports(store.read("cd_runs_imports"));
    launchedRef.current = store.read("cd_runs_launched");
  }, []);

  const toggleArchived = (runId) => {
    setArchived((a) => {
      const next = { ...a };
      if (next[runId]) delete next[runId]; else next[runId] = true;
      store.write("cd_runs_archived", next);
      return next;
    });
  };

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
  const parsedSearchTerms = searchTerms.split(",").map((q) => q.trim()).filter(Boolean);
  // Videos actually returned = whichever is smaller: what the hashtags and
  // search terms can yield, or the hard cap. Cost and forecasts flow from it.
  const sourceCount = parsedHashtags.length + parsedSearchTerms.length;
  const expVideos = Math.min(sourceCount * (parseInt(resultsPerPage, 10) || 0), parseInt(maxItems, 10) || 0);
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
      setSearchTerms((data.searchQueries || []).join(", "));
      setResultsPerPage(data.resultsPerPage);
      setDays(data.days);
      setMaxItems(data.maxItems);
      if (data.minFollowers) setMinFollowers(data.minFollowers);
      if (data.maxFollowers) setMaxFollowers(data.maxFollowers);
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
        body: JSON.stringify({
          hashtags: parsedHashtags, searchQueries: parsedSearchTerms,
          resultsPerPage, days, maxItems, minFollowers, maxFollowers, threshold,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      // Remember we launched it so it auto-imports the moment it succeeds
      launchedRef.current = { ...launchedRef.current, [data.id]: true };
      store.write("cd_runs_launched", launchedRef.current);
      await loadStatus();
    } catch (e) {
      setError("Couldn't launch the run: " + e.message);
    } finally { setLaunching(false); }
  };

  const importRun = useCallback(async (runId, { force = false } = {}) => {
    if (importInFlightRef.current) return;
    importInFlightRef.current = true;
    setImporting(runId); setImportResult(null);
    try {
      // Large runs are processed in capped batches server-side; keep calling
      // until nothing remains (each pass only touches unprocessed creators).
      let data;
      for (let pass = 0; pass < 8; pass++) {
        const res = await fetch("/api/source/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, days, force: force && pass === 0 }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
        if (!data.remaining) break;
      }
      setImportResult(data);
      setImports((im) => {
        const next = { ...im, [runId]: { inserted: data.inserted, screened: data.screened, alreadyKnown: data.alreadyKnown, videosFetched: data.videosFetched, at: Date.now() } };
        store.write("cd_runs_imports", next);
        return next;
      });
      onImported?.();
      await loadStatus();
    } catch (e) {
      setImportResult({ error: e.message });
    } finally {
      // Success or failure, stop the auto-import loop for this run — a
      // persistent error must not retry forever on someone else's dime.
      delete launchedRef.current[runId];
      store.write("cd_runs_launched", launchedRef.current);
      importInFlightRef.current = false;
      setImporting(null);
    }
  }, [days, onImported, loadStatus]);

  // Auto-import: a run launched from the app that just reached SUCCEEDED
  useEffect(() => {
    if (importing || importInFlightRef.current) return;
    const ready = status?.runs?.find(
      (r) => r.status === "SUCCEEDED" && launchedRef.current[r.id] && !imports[r.id] && !r.importResult?.done
    );
    if (ready) importRun(ready.id);
  }, [status, imports, importing, importRun]);

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

        <div className="preset-row">
          <span className="eyebrow" style={{ marginRight: 4 }}>NICHE PRESETS</span>
          {Object.entries(PRESETS).map(([name, tags]) => (
            <button
              key={name}
              className={"chip" + (hashtags === tags ? " on" : "")}
              onClick={() => setHashtags(tags)}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="fields">
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Hashtags</span>
            <input className="input" value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Search terms (optional — reaches creators hashtags miss, comma-separated)</span>
            <input
              className="input"
              placeholder='e.g. day in my life uni student, study vlog, how I revise'
              value={searchTerms}
              onChange={(e) => setSearchTerms(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Videos per source</span>
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
          <label className="field">
            <span>Min followers</span>
            <input className="input" type="number" value={minFollowers} onChange={(e) => setMinFollowers(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Max followers</span>
            <input className="input" type="number" value={maxFollowers} onChange={(e) => setMaxFollowers(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Score bar (60–85)</span>
            <input className="input" type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </label>
        </div>

        <div className="forecast">
          <div className="eyebrow">RUN FORECAST (ESTIMATE)</div>
          <div className="forecast-line">
            <b className="mono">{expVideos}</b> videos from {parsedHashtags.length} hashtags{parsedSearchTerms.length > 0 && ` + ${parsedSearchTerms.length} searches`}
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
              ⚠ Most of these hashtags don&apos;t obviously point at Anara&apos;s audiences (study, students,
              lifestyle, tech, career) or on-camera creators — the forecast may not hold. Very generic tags
              tend to surface faceless meme/edit accounts that score low.
            </p>
          )}
        </div>

        <div className="launch-row">
          <span className="soft" style={{ fontSize: 13 }}>
            scrape cost ~${estCost} <span className="mono" style={{ fontSize: 11 }}>(estimate)</span> + a few cents of scoring
          </span>
          <button className="primary" onClick={launch} disabled={launching || (!parsedHashtags.length && !parsedSearchTerms.length)}>
            {launching ? "Launching…" : "Launch run"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div className="eyebrow">RECENT RUNS</div>
        {Object.keys(archived).length > 0 && (
          <button className="chip" onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? "Hide archived" : `Archived (${Object.keys(archived).length})`}
          </button>
        )}
      </div>
      {(!status.runs || status.runs.length === 0) && <p className="soft" style={{ fontSize: 13.5 }}>No runs yet.</p>}
      <div className="runs">
        {status.runs?.filter((r) => showArchived || !archived[r.id]).map((r) => {
          // Prefer the server-side import record (shared across devices);
          // fall back to this browser's memory of older imports.
          const imp = r.importResult?.summary || imports[r.id];
          const partial = r.importResult && !r.importResult.done;
          const isImporting = importing === r.id;
          const wasLaunchedHere = Boolean(launchedRef.current[r.id]);
          return (
            <div key={r.id} className={"run-card" + (archived[r.id] ? " dim" : "")}>
              <div className="run-line">
                <span className={"badge run-" + r.status.toLowerCase()}>{r.status}</span>
                <span className="mono soft">{fmtWhen(r.startedAt)}</span>
                <span className="run-tags" title={r.hashtags.join(", ")}>
                  {r.hashtags.length ? "#" + r.hashtags.slice(0, 3).join(" #") + (r.hashtags.length > 3 ? ` +${r.hashtags.length - 3}` : "") : "—"}
                </span>
                <span className="mono soft run-nums">
                  {r.videos != null ? `${r.videos} videos` : ""} {r.usageUsd != null ? `· ${fmtUsd(r.usageUsd)}` : ""}
                </span>
                <button className="ghost tiny" title={archived[r.id] ? "Unarchive" : "Archive"} onClick={() => toggleArchived(r.id)}>
                  {archived[r.id] ? "↩" : "✕"}
                </button>
              </div>
              <div className="run-line2">
                {isImporting && <span className="soft run-summary">Scoring… takes a minute or two</span>}
                {!isImporting && imp && (
                  <span className="run-summary ok">
                    {partial ? "◐ partially imported" : "✓ imported"} → <b>{imp.inserted} added to Review</b> · {imp.screened} screened out · {imp.alreadyKnown} already known
                  </span>
                )}
                {!isImporting && !imp && r.status === "SUCCEEDED" && (
                  <span className="soft run-summary">{wasLaunchedHere ? "Waiting to auto-import…" : "Not imported yet"}</span>
                )}
                {!isImporting && !imp && r.status !== "SUCCEEDED" && (
                  <span className="soft run-summary">{r.status === "RUNNING" || r.status === "READY" ? "Scraping… auto-imports when done" : "Run did not finish"}</span>
                )}
                {r.status === "SUCCEEDED" && !isImporting && (
                  <button
                    className="ghost small"
                    onClick={() => importRun(r.id, { force: Boolean(imp) && !partial })}
                    disabled={importing !== null}
                  >
                    {partial ? "Continue import" : imp ? "Re-check" : "Import & score"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {importResult && !importResult.error && (
        <>
          <div className="banner" style={{ marginTop: 14, borderRadius: 10 }}>
            Imported: {importResult.inserted} new candidates added to the queue ·{" "}
            {importResult.videosFetched} videos → {importResult.uniqueCreators} creators ·{" "}
            {importResult.alreadyKnown} already known · {importResult.screened} screened out
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
                When even the best scores are far below 73, the run mostly hit faceless or low-engagement
                accounts — aim hashtags at creators who appear on camera (study, student life, lifestyle,
                tech, day-in-my-life…).
              </p>
            </div>
          )}
        </>
      )}
      {importResult?.error && (
        <div className="banner bad" style={{ marginTop: 14, borderRadius: 10 }}>Import failed: {importResult.error}</div>
      )}
      <p className="hint">
        Runs you launch here import themselves automatically when the scrape finishes (keep the tab open) —
        candidates are filtered, scored, deduped, and anyone at 73+ lands in Review. Everyone scored below the
        bar is recorded as &quot;Screened&quot; in Notion, so no creator is ever scored twice. ✕ archives a run
        from this list.
      </p>
    </div>
  );
}
