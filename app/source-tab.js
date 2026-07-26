"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { IconX, IconUndo } from "./icons";

// The creator program hires PROFESSIONAL UGC FREELANCERS now (not study/
// lifestyle influencers). Both hunting grounds — TikTok hashtags and LinkedIn
// job titles — are country-scoped; scoring does the UGC + country judgment.
const UGC_COUNTRIES = ["United States", "United Kingdom", "Canada", "Australia"];
const CC_SHORT = { "United States": "US", "United Kingdom": "UK", Canada: "Canada", Australia: "Australia" };
const TT_PER_RESULT = 0.005; // TikTok pay-per-result estimate

// Client-side run memory (single-user app): which runs are archived, and
// which were imported and what they yielded.
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

// Researcher run builder (LinkedIn people-search) — Laia's pharma/biotech/CRO
// hiring. Grouped role checkboxes + countries; cost is dominated by the
// per-full-profile charge (~$4 / 1,000).
const RESEARCHER_ROLE_GROUPS = {
  "Clinical & trials": ["Clinical Research Associate", "Clinical Trial Assistant", "Clinical Research Coordinator", "Clinical Data Manager", "Research Nurse"],
  "Medical & regulatory": ["Medical Writer", "Medical Science Liaison", "Medical Affairs Associate", "Regulatory Affairs Associate", "Pharmacovigilance Associate"],
  "Science & quality": ["Research Associate", "Biomedical Engineer", "QA Associate"],
};
const RESEARCHER_COUNTRIES = ["United States", "United Kingdom", "Canada", "Australia"];
const LI_PER_PROFILE = 0.004; // full profile
const LI_PER_PAGE = 0.1;      // per 25-result search page

export default function SourceTab({ onImported, scope = "mine", track = "creator", onBusyChange }) {
  const [status, setStatus] = useState(null); // { ready, spend, runs, estPerResult }
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState(null);
  // Researcher form state
  const [rRoles, setRRoles] = useState(["Medical Writer"]);
  const [rCountries, setRCountries] = useState(["United States", "United Kingdom"]);
  const [rActive, setRActive] = useState(false);
  const [rMax, setRMax] = useState(100);
  const [rMaxIg, setRMaxIg] = useState(100);
  // Creator UGC form state (shared country selection, per-platform max)
  const [cCountries, setCCountries] = useState(["United States", "United Kingdom"]);
  const [cMaxTt, setCMaxTt] = useState(500);
  const [cMaxLi, setCMaxLi] = useState(100);
  const [threshold, setThreshold] = useState(70);
  const [launching, setLaunching] = useState(null); // null | "res-li" | "res-ig" | "ugc-tt" | "ugc-li"
  const [importing, setImporting] = useState(null); // runId
  const [importResult, setImportResult] = useState(null);
  const [lockedRuns, setLockedRuns] = useState({}); // runId -> true: import in progress elsewhere
  const [archived, setArchived] = useState({});
  const [imports, setImports] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  // Synchronous in-flight guard: React state updates too late to stop a
  // double-click starting the same import twice.
  const importInFlightRef = useRef(false);
  const pollRef = useRef(null);

  useEffect(() => {
    setArchived(store.read("cd_runs_archived"));
    setImports(store.read("cd_runs_imports"));
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
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/source/status?scope=${scope}&track=${track}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      setStatus(data);
      setError(null);
      return data;
    } catch (e) {
      setError("Couldn't reach Apify: " + e.message);
      return null;
    } finally { setStatusLoading(false); }
  }, [scope, track]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Report loading up to the shell (track-switch overlay holds on it)
  useEffect(() => { onBusyChange?.(statusLoading); }, [statusLoading, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // Poll while any run is still scraping, an import is running (here or on
  // another device — the checkpoints feed the progress bar), or a partial
  // import is fresh enough to still be alive.
  useEffect(() => {
    const now = Date.now();
    const hasActive = status?.runs?.some((r) =>
      ["RUNNING", "READY"].includes(r.status) ||
      (r.importResult && !r.importResult.done && r.importResult.at && now - r.importResult.at < 3 * 60_000)
    ) || Object.keys(lockedRuns).length > 0 || importing !== null;
    clearInterval(pollRef.current);
    if (hasActive) pollRef.current = setInterval(loadStatus, 15000);
    return () => clearInterval(pollRef.current);
  }, [status, loadStatus, lockedRuns, importing]);

  const toggleIn = (setter, list, val) => setter(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
  // Creator UGC cost estimates
  const cMaxTtN = Math.max(10, Math.min(1500, parseInt(cMaxTt, 10) || 0));
  const cMaxLiN = Math.max(5, Math.min(1000, parseInt(cMaxLi, 10) || 0));
  const ttCost = (cMaxTtN * TT_PER_RESULT).toFixed(2);
  const liCost = (Math.ceil(cMaxLiN / 25) * LI_PER_PAGE + cMaxLiN * LI_PER_PROFILE).toFixed(2);

  // One creator launcher for both hunting grounds — the run route branches on
  // the presence of `platform`.
  const launchCreator = async (platform) => {
    setLaunching(platform === "LinkedIn" ? "ugc-li" : "ugc-tt"); setImportResult(null);
    try {
      const body = platform === "LinkedIn"
        ? { platform: "LinkedIn", countries: cCountries, maxItems: cMaxLiN, threshold }
        : { countries: cCountries, maxItems: cMaxTtN, threshold };
      const res = await fetch("/api/source/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      await loadStatus();
    } catch (e) {
      setError("Couldn't launch the run: " + e.message);
    } finally { setLaunching(null); }
  };
  const rMaxN = Math.max(5, Math.min(1000, parseInt(rMax, 10) || 0));
  // ~1 search page per 25 results + full profile per result
  const rCost = (Math.ceil(rMaxN / 25) * LI_PER_PAGE + rMaxN * LI_PER_PROFILE).toFixed(2);
  const rMaxIgN = Math.max(10, Math.min(500, parseInt(rMaxIg, 10) || 0));
  // discovery posts/accounts + per-profile enrichment on import
  const rIgCost = (rMaxIgN * 0.008).toFixed(2);

  // Instagram fires up to three discovery runs from one click — the response
  // carries a runs[] array rather than a single id.
  const launchResearcherIg = async () => {
    setLaunching("res-ig"); setImportResult(null);
    try {
      const res = await fetch("/api/source/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: "researcher", platform: "Instagram", roles: rRoles, countries: rCountries, maxItems: rMaxIgN, threshold }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      await loadStatus();
    } catch (e) {
      setError("Couldn't launch the runs: " + e.message);
    } finally { setLaunching(null); }
  };

  const launchResearcher = async () => {
    setLaunching("res-li"); setImportResult(null);
    try {
      const res = await fetch("/api/source/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: "researcher", roles: rRoles, countries: rCountries, activeRecently: rActive, maxItems: rMaxN, threshold }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      await loadStatus();
    } catch (e) {
      setError("Couldn't launch the run: " + e.message);
    } finally { setLaunching(null); }
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
          body: JSON.stringify({ runId, force: force && pass === 0 }),
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
      setLockedRuns((s) => { const n = { ...s }; delete n[runId]; return n; });
      await loadStatus();
    } catch (e) {
      // The per-run lock means another device (or the background watcher) is
      // already on it — that's a status, not a failure.
      if (/already in progress/i.test(e.message)) {
        setLockedRuns((s) => ({ ...s, [runId]: true }));
      } else {
        setImportResult({ error: e.message });
      }
    } finally {
      importInFlightRef.current = false;
      setImporting(null);
    }
  }, [onImported, loadStatus]);

  if (!status && !error) return (
    <div className="skeleton-wrap" aria-label="Loading">
      <div className="sk sk-bar" />
      <div className="sk sk-card" />
      <div className="sk sk-row" />
      <div className="sk sk-row" />
    </div>
  );

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
            <div className="eyebrow">Apify spend this cycle</div>
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

      {track === "researcher" ? (
      <>
        <div className="card" style={{ padding: "18px 22px", marginBottom: 14 }}>
          <div className="eyebrow">Roles &amp; countries</div>
          <p className="soft" style={{ fontSize: 12.5, margin: "6px 0 10px" }}>
            Shared by both hunts below. Roles are exact job titles on LinkedIn · search keywords on Instagram.
          </p>
          {Object.entries(RESEARCHER_ROLE_GROUPS).map(([group, roles]) => (
            <div className="preset-row" key={group} style={{ marginTop: 8 }}>
              <span className="eyebrow" style={{ marginRight: 4 }}>{group}</span>
              {roles.map((role) => (
                <button key={role} className={"chip" + (rRoles.includes(role) ? " on" : "")} onClick={() => toggleIn(setRRoles, rRoles, role)}>{role}</button>
              ))}
            </div>
          ))}
          <div className="preset-row" style={{ marginTop: 8 }}>
            <span className="eyebrow" style={{ marginRight: 4 }}>Countries</span>
            {RESEARCHER_COUNTRIES.map((c) => (
              <button key={c} className={"chip" + (rCountries.includes(c) ? " on" : "")} onClick={() => toggleIn(setRCountries, rCountries, c)}>{c}</button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: "20px 22px", marginBottom: 14 }}>
          <div className="eyebrow">Hunt researchers on LinkedIn</div>
          <p className="soft" style={{ fontSize: 13, margin: "8px 0 12px", lineHeight: 1.55 }}>
            Searches LinkedIn for early-career people in the selected roles at pharma / biotech / CRO companies.
            Senior titles, recruiters, and freelancers are filtered out; scoring judges the rest. Each search
            combination continues where it left off — re-run it weekly for fresh profiles.
          </p>
          <div className="preset-row" style={{ marginTop: 0 }}>
            <button className={"chip" + (rActive ? " on" : "")} onClick={() => setRActive((v) => !v)}>
              {rActive ? "✓ " : ""}Active on LinkedIn recently
            </button>
            {rActive && <span className="soft" style={{ fontSize: 12 }}>posted in the last ~30 days — more likely to reply &amp; make content</span>}
          </div>
          <div className="fields">
            <label className="field">
              <span>Max profiles</span>
              <input className="input" type="number" value={rMax} onChange={(e) => setRMax(e.target.value)} />
            </label>
            <label className="field">
              <span>Score bar (60–85)</span>
              <input className="input" type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
          </div>
          <div className="launch-row">
            <span className="soft" style={{ fontSize: 13 }}>
              scrape cost ~${rCost} <span className="mono" style={{ fontSize: 11 }}>(estimate)</span> + a few cents of scoring
            </span>
            <button className="primary" onClick={launchResearcher} disabled={launching !== null || !rRoles.length || !rCountries.length}>
              {launching === "res-li" ? "Launching…" : "Launch LinkedIn run"}
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: "20px 22px", marginBottom: 16 }}>
          <div className="eyebrow">Hunt researchers on Instagram</div>
          <p className="soft" style={{ fontSize: 13, margin: "8px 0 12px", lineHeight: 1.55 }}>
            One click fires three discovery runs: account search using the roles selected above, a rotating
            sweep of researcher hashtags, and accounts similar to your existing Instagram finds. Profiles are
            enriched and scored on import; country is judged from the account (best effort, not a hard filter).
          </p>
          <div className="fields">
            <label className="field">
              <span>Max profiles</span>
              <input className="input" type="number" value={rMaxIg} onChange={(e) => setRMaxIg(e.target.value)} />
            </label>
            <label className="field">
              <span>Score bar (60–85)</span>
              <input className="input" type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
          </div>
          <div className="launch-row">
            <span className="soft" style={{ fontSize: 13 }}>
              scrape cost ~${rIgCost} <span className="mono" style={{ fontSize: 11 }}>(estimate)</span> + a few cents of scoring
            </span>
            <button className="primary" onClick={launchResearcherIg} disabled={launching !== null || !rRoles.length || !rCountries.length}>
              {launching === "res-ig" ? "Launching…" : "Launch Instagram runs"}
            </button>
          </div>
        </div>
      </>
      ) : (
      <>
        <div className="card" style={{ padding: "20px 22px", marginBottom: 14 }}>
          <div className="eyebrow">Countries</div>
          <p className="soft" style={{ fontSize: 12.5, margin: "6px 0 10px" }}>
            Shared by both searches. Exact on LinkedIn · best-effort on TikTok.
          </p>
          <div className="preset-row" style={{ marginTop: 0 }}>
            {UGC_COUNTRIES.map((c) => (
              <button key={c} className={"chip" + (cCountries.includes(c) ? " on" : "")} onClick={() => toggleIn(setCCountries, cCountries, c)}>{c}</button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: "20px 22px", marginBottom: 14 }}>
          <div className="eyebrow">Hunt UGC creators on TikTok</div>
          <p className="soft" style={{ fontSize: 13, margin: "8px 0 12px", lineHeight: 1.55 }}>
            Scrapes a rotating set of UGC-for-hire hashtags; scoring keeps only dedicated UGC-freelancer
            accounts in your countries. Follower counts are ignored.
          </p>
          <div className="fields">
            <label className="field">
              <span>Max total results</span>
              <input className="input" type="number" value={cMaxTt} onChange={(e) => setCMaxTt(e.target.value)} />
            </label>
            <label className="field">
              <span>Score bar (60–85)</span>
              <input className="input" type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
          </div>
          <div className="launch-row">
            <span className="soft" style={{ fontSize: 13 }}>
              scrape cost ~${ttCost} <span className="mono" style={{ fontSize: 11 }}>(estimate)</span> + a few cents of scoring
            </span>
            <button className="primary" onClick={() => launchCreator("TikTok")} disabled={launching !== null || !cCountries.length}>
              {launching === "ugc-tt" ? "Launching…" : "Launch TikTok run"}
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: "20px 22px", marginBottom: 16 }}>
          <div className="eyebrow">Hunt UGC freelancers on LinkedIn</div>
          <p className="soft" style={{ fontSize: 13, margin: "8px 0 12px", lineHeight: 1.55 }}>
            Searches people whose LinkedIn job title is UGC / Content Creator in your countries — freelancers
            who list their trade and reply. Each run walks fresh profiles (see below), so re-run it weekly.
          </p>
          <div className="fields">
            <label className="field">
              <span>Max profiles</span>
              <input className="input" type="number" value={cMaxLi} onChange={(e) => setCMaxLi(e.target.value)} />
            </label>
            <label className="field">
              <span>Score bar (60–85)</span>
              <input className="input" type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
          </div>
          {status?.liCursor?.startPage > 1 && (
            <p className="soft" style={{ fontSize: 12, margin: "10px 0 4px" }}>
              Continuing from page {status.liCursor.startPage} — each run walks fresh profiles.
            </p>
          )}
          <div className="launch-row">
            <span className="soft" style={{ fontSize: 13 }}>
              scrape cost ~${liCost} <span className="mono" style={{ fontSize: 11 }}>(estimate)</span> + a few cents of scoring
            </span>
            <button className="primary" onClick={() => launchCreator("LinkedIn")} disabled={launching !== null || !cCountries.length}>
              {launching === "ugc-li" ? "Launching…" : "Launch LinkedIn run"}
            </button>
          </div>
        </div>
      </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div className="eyebrow">Recent runs</div>
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
          // Checkpoints are written every ~30s while an import runs, so a
          // fresh partial record means someone is actively importing — a
          // stale one means it crashed and needs "Continue import".
          const activeElsewhere = !isImporting && partial && r.importResult?.at && Date.now() - r.importResult.at < 3 * 60_000;
          // A finished import supersedes the "locked elsewhere" flag
          const lockedElsewhere = (Boolean(lockedRuns[r.id]) || activeElsewhere) && !(imp && !partial);
          const prog = r.importResult?.progress;
          const pct = prog?.total > 0 ? Math.min(100, Math.round((prog.done / prog.total) * 100)) : null;
          return (
            <div key={r.id} className={"run-card" + (archived[r.id] ? " dim" : "")}>
              <div className="run-line">
                <span className={"badge run-" + r.status.toLowerCase()}>{r.status}</span>
                <span className="mono soft">{fmtWhen(r.startedAt)}</span>
                <span className="run-tags" title={(r.roles?.length ? r.roles : r.hashtags).join(", ") || r.label || ""}>
                  {r.roles?.length
                    ? r.roles.slice(0, 2).join(", ") + (r.roles.length > 2 ? ` +${r.roles.length - 2}` : "") + (r.label ? ` · ${r.label}` : "")
                    : r.label
                      ? r.label
                      : r.runPlatform === "LinkedIn"
                        ? `UGC · LinkedIn${r.countries?.length ? " · " + r.countries.map((c) => CC_SHORT[c] || c).join(", ") : ""}`
                        : r.hashtags.length ? "#" + r.hashtags.slice(0, 3).join(" #") + (r.hashtags.length > 3 ? ` +${r.hashtags.length - 3}` : "") : "UGC · TikTok"}
                </span>
                <span className="mono soft run-nums">
                  {r.videos != null ? `${r.videos} ${r.runPlatform === "LinkedIn" ? "profiles" : r.runPlatform === "Instagram" ? "items" : "videos"}` : ""} {r.usageUsd != null ? `· ${fmtUsd(r.usageUsd)}` : ""}
                </span>
                <button className="ghost tiny" title={archived[r.id] ? "Unarchive" : "Archive"} aria-label={archived[r.id] ? "Unarchive run" : "Archive run"} onClick={() => toggleArchived(r.id)}>
                  {archived[r.id] ? <IconUndo width={13} height={13} /> : <IconX width={13} height={13} />}
                </button>
              </div>
              <div className="run-line2">
                {isImporting && (
                  <span className="soft run-summary run-working">
                    <span className="run-progress"><span className="run-progress-fill" style={{ width: `${pct ?? 8}%` }} /></span>
                    {pct != null ? `Scoring ${prog.done} of ${prog.total} creators…` : "Scoring… first results in ~1 min"}
                  </span>
                )}
                {!isImporting && lockedElsewhere && (
                  <span className="soft run-summary run-working">
                    <span className="run-progress"><span className="run-progress-fill" style={{ width: `${pct ?? 8}%` }} /></span>
                    ⏳ importing{pct != null ? ` — ${prog.done} of ${prog.total} scored` : ""}{imp?.inserted != null ? <> · <b>{imp.inserted} added so far</b></> : null}
                  </span>
                )}
                {!isImporting && !lockedElsewhere && imp && (
                  <span className="run-summary ok">
                    {partial ? "◐ partially imported" : "✓ imported"} → <b>{imp.inserted} added to Review</b> · {imp.screened} screened out · {imp.alreadyKnown} already known
                  </span>
                )}
                {!isImporting && !lockedElsewhere && !imp && r.status === "SUCCEEDED" && (
                  <span className="soft run-summary">Not imported yet</span>
                )}
                {!isImporting && !imp && r.status !== "SUCCEEDED" && (
                  <span className="soft run-summary">{r.status === "RUNNING" || r.status === "READY" ? "Scraping… import & score when it finishes" : "Run did not finish"}</span>
                )}
                {r.status === "SUCCEEDED" && !isImporting && !lockedElsewhere && (
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
              <div className="eyebrow">Nothing cleared the bar — closest misses</div>
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
        When a scrape finishes, hit <b>Import &amp; score</b> on its run card. Candidates are filtered, scored,
        deduped, and anyone clearing your score bar lands in Review; everyone below it is recorded as
        &quot;Screened&quot; in Notion, so no creator is ever scored twice. The ✕ on a run card archives it from this list.
      </p>
    </div>
  );
}
