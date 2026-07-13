"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  STAGES, ONBOARD_STAGES, LINKS,
  firstNameOf, renderDm, DEFAULT_DM, igWelcome, welcomeEmail, mailtoLink,
  INTERVIEW_INTRO, INTERVIEW_CLOSE, CONTRACT_STEPS, IG_SETUP,
} from "@/lib/templates";
import SourceTab from "./source-tab";
import OrganicTab from "./organic-tab";
import HqTab from "./hq-tab";
import { IconX, IconCheck, IconExt } from "./icons";

// =============================================================
// ANARA CASTING DESK — creator sourcing + onboarding cockpit
// Source of truth: Notion "Creator Sourcing Pipeline" database,
// reached through this app's own API routes (direct Notion API).
// =============================================================

// ---- clipboard with fallback (some browsers block the async API) ----
function useCopy() {
  const [fallbackText, setFallbackText] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const copy = async (key, text) => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (ok) { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1600); }
    else setFallbackText(text);
  };
  return { copy, copiedKey, fallbackText, setFallbackText };
}

export default function AnaraCastingDesk() {
  const [tab, setTab] = useState("hq");
  const [queue, setQueue] = useState([]);
  const [roster, setRoster] = useState([]);
  const [counts, setCounts] = useState({});
  const [weekly, setWeekly] = useState(null);
  const [view, setView] = useState("one"); // "one" | "browse"
  const [selected, setSelected] = useState(null);
  const [onboardSearch, setOnboardSearch] = useState("");
  const [onboardStage, setOnboardStage] = useState("All");
  const [onboardOwner, setOnboardOwner] = useState("All");
  const [user, setUser] = useState(null);
  const [team, setTeam] = useState(["lucas", "laia", "alba"]);
  const [scope, setScope] = useState("mine"); // "mine" | "all"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [pending, setPending] = useState({}); // pageId -> new status
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const { copy, copiedKey, fallbackText, setFallbackText } = useCopy();

  // Personal outreach DM: every account has its own template ({first} token),
  // fetched once and used by every copy-DM / email button.
  const [dmTpl, setDmTpl] = useState(null);
  const [dmOpen, setDmOpen] = useState(false);
  const [dmDraft, setDmDraft] = useState("");
  const [dmSaving, setDmSaving] = useState(false);
  const [dmErr, setDmErr] = useState(null);
  useEffect(() => {
    fetch("/api/settings/dm").then((r) => r.json()).then((d) => { if (d.template) setDmTpl(d.template); }).catch(() => {});
  }, []);
  const dmFor = useCallback((first) => renderDm(dmTpl, first), [dmTpl]);
  const saveDm = async () => {
    setDmSaving(true); setDmErr(null);
    try {
      const res = await fetch("/api/settings/dm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: dmDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      setDmTpl(data.template);
      setDmOpen(false);
    } catch (e) {
      setDmErr(e.message);
    } finally { setDmSaving(false); }
  };

  // Guards against a slow older fetch overwriting a newer one (e.g. after a
  // quick scope toggle) — only the latest request may apply its response.
  const loadSeq = useRef(0);
  const load = useCallback(async ({ keepPending = false, scope: sc } = {}) => {
    const seq = ++loadSeq.current;
    setLoading(true); setError(null); setNeedsSetup(false);
    try {
      const res = await fetch(`/api/pipeline?scope=${sc || scope}`);
      const data = await res.json();
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        if (data.error === "setup") { setNeedsSetup(true); return; }
        throw new Error(data.message || `Request failed (${res.status})`);
      }
      setQueue(data.queue);
      setRoster(data.roster);
      setCounts(data.counts);
      setWeekly(data.weekly || null);
      if (data.user) setUser(data.user);
      if (data.team) setTeam(data.team);
      if (!keepPending) setPending({});
      setSelected((s) => (data.roster.some((r) => r.id === s) ? s : null));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError("Couldn't load the pipeline from Notion. " + e.message + " — press Reload to retry.");
    } finally { if (seq === loadSeq.current) setLoading(false); }
  }, [scope]);

  // One fetch on mount, with the remembered scope — setting state first and
  // letting a scope-dependent effect refetch would race two requests.
  useEffect(() => {
    let s = "mine";
    try { const v = localStorage.getItem("cd_scope"); if (v === "all" || v === "mine") s = v; } catch {}
    setScope(s);
    load({ scope: s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchScope = (s) => {
    setScope(s);
    try { localStorage.setItem("cd_scope", s); } catch {}
    load({ keepPending: pendingCount > 0, scope: s });
  };

  // ── Background run watcher ─────────────────────────────────────────
  // Sourcing runs launched from the Source tab are imported HERE, at the
  // app shell, so the import happens and the confirmation shows no matter
  // which tab is open. State lives in localStorage (cd_runs_launched /
  // cd_runs_imports), shared with the Source tab.
  const [importToast, setImportToast] = useState(null);
  const [importsVersion, setImportsVersion] = useState(0); // bumps so a mounted Source tab refreshes its run cards
  // Auto-dismiss: the run card keeps the full summary, so the toast can go
  const [toastPaused, setToastPaused] = useState(false);
  useEffect(() => {
    if (!importToast || toastPaused) return;
    const t = setTimeout(() => setImportToast(null), 6500);
    return () => clearTimeout(t);
  }, [importToast, toastPaused]);
  const watcherBusyRef = useRef(false);
  const loadRef = useRef(null);
  loadRef.current = load;
  useEffect(() => {
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch { return {}; } };
    const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
    const forget = (id) => { const l = read("cd_runs_launched"); delete l[id]; write("cd_runs_launched", l); };

    const tick = async () => {
      if (watcherBusyRef.current) return;
      const launched = read("cd_runs_launched");
      if (!Object.keys(launched).length) return; // nothing pending — no Apify calls
      watcherBusyRef.current = true;
      try {
        const res = await fetch("/api/source/status?scope=mine");
        const data = await res.json();
        if (!res.ok) return;
        for (const id of Object.keys(launched)) {
          const run = data.runs?.find((r) => r.id === id);
          if (!run) { forget(id); continue; } // fell off the recent-runs window
          if (["RUNNING", "READY"].includes(run.status)) continue; // still scraping
          if (run.status !== "SUCCEEDED") {
            forget(id);
            setImportToast({ bad: true, text: `Sourcing run ${run.status.toLowerCase()} — nothing to import.` });
            continue;
          }
          let summary = run.importResult?.done ? run.importResult.summary : null;
          let unfinished = false;
          if (!summary) {
            // Import in capped server-side batches until nothing remains
            try {
              let locked = false;
              for (let pass = 0; pass < 10; pass++) {
                const r2 = await fetch("/api/source/import", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ runId: id }),
                });
                const d2 = await r2.json();
                if (r2.status === 409) { locked = true; break; } // another device importing — retry next tick
                if (!r2.ok) throw new Error(d2.message || `Import failed (${r2.status})`);
                summary = d2;
                if (!d2.remaining) break;
              }
              if (locked) continue;
              unfinished = Boolean(summary?.remaining);
            } catch (e) {
              // A pass died (timeout / network). Progress so far is already
              // checkpointed server-side — retry next tick, give up after 3.
              const l = read("cd_runs_launched");
              const tries = ((l[id] && l[id].tries) || 0) + 1;
              if (tries >= 3) {
                forget(id);
                setImportToast({ bad: true, text: `Auto-import failed 3 times: ${e.message} — use "Continue import" on the run card to resume by hand.` });
              } else {
                l[id] = { tries };
                write("cd_runs_launched", l);
              }
              continue;
            }
          }
          if (summary && !unfinished) {
            const im = read("cd_runs_imports");
            im[id] = { inserted: summary.inserted, screened: summary.screened, alreadyKnown: summary.alreadyKnown, videosFetched: summary.videosFetched, at: Date.now() };
            write("cd_runs_imports", im);
            forget(id);
            setImportToast({
              bad: false,
              text: `✓ Sourcing run imported — ${summary.inserted} added to Review · ${summary.screened} screened out · ${summary.alreadyKnown} already known`,
            });
            setImportsVersion((v) => v + 1);
            loadRef.current?.({ keepPending: true });
          }
          // unfinished: stay in cd_runs_launched — the next tick continues
        }
      } catch (e) {
        setImportToast({ bad: true, text: "Auto-import failed: " + e.message });
      } finally {
        watcherBusyRef.current = false;
      }
    };
    tick();
    const iv = setInterval(tick, 30000);
    return () => clearInterval(iv);
  }, []);

  const remaining = queue.filter((c) => !pending[c.id]);
  const current = remaining[0];
  const pendingCount = Object.keys(pending).length;

  const decide = useCallback((verdict) => {
    if (!current) return;
    setPending((p) => ({ ...p, [current.id]: verdict }));
  }, [current]);

  const undo = useCallback(() => {
    setPending((p) => {
      const ids = Object.keys(p);
      if (!ids.length) return p;
      const n = { ...p };
      delete n[ids[ids.length - 1]];
      return n;
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      // Only in one-by-one review: in Browse (or other tabs) the shortcuts
      // would act on a card that isn't on screen.
      if (tab !== "review" || view !== "one") return;
      if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.key === "a" || e.key === "A") decide("Approved");
      if (e.key === "r" || e.key === "R") decide("Rejected");
      if (e.key === "u" || e.key === "U") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, undo, tab, view]);

  const sync = async () => {
    const entries = Object.entries(pending);
    if (!entries.length) return;
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch("/api/pages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: entries.map(([id, status]) => ({ id, status })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      if (data.failed?.length) {
        // Keep only the failed decisions queued so Save can retry just those
        const failedIds = new Set(data.failed.map((f) => f.id));
        setPending((p) => Object.fromEntries(Object.entries(p).filter(([id]) => failedIds.has(id))));
        setSyncMsg(`Saved ${data.updated}, but ${data.failed.length} failed — still queued, press Save to retry.`);
        await load({ keepPending: true });
      } else {
        setPending({});
        setSyncMsg(`Saved ${data.updated} to Notion.`);
        await load();
        setTimeout(() => setSyncMsg(null), 3000);
      }
    } catch (e) {
      setSyncMsg("Sync failed: " + e.message + ". Decisions still queued — try Save again.");
    } finally { setSyncing(false); }
  };

  const stageOf = (c) => pending[c.id] || c.status;
  const moveStage = (c, stage) => setPending((p) => ({ ...p, [c.id]: stage }));

  const displayCounts = STAGES.map((s) => {
    let n = counts[s] || 0;
    Object.entries(pending).forEach(([id, v]) => {
      const inQueue = queue.find((q) => q.id === id);
      const inRoster = roster.find((q) => q.id === id);
      const from = inQueue ? "New" : inRoster ? inRoster.status : null;
      if (from === s) n -= 1;
      if (v === s) n += 1;
    });
    return { stage: s, n: Math.max(n, 0) };
  });

  const fmt = (n) => n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);

  if (needsSetup) return (
    <div className="desk">
      <div className="empty">
        <div className="empty-title">One-time setup needed</div>
        <div className="setup-steps">
          1. Go to <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" style={{ color: "#6E7BFF" }}>notion.so/my-integrations</a> and create an internal integration.<br />
          2. In Notion, open the Creator Sourcing Pipeline database → ••• menu → Connections → add your integration.<br />
          3. Paste the integration secret into <span className="mono">.env.local</span> as <span className="mono">NOTION_TOKEN</span>.<br />
          4. Restart the dev server and reload this page.
        </div>
      </div>
    </div>
  );

  return (
    <div className="desk">
      <header className="top">
        <div className="brand">
          <div className="title-row">
            <h1>ANARA Hiring HQ</h1>
            {user && <span className="signed-in mono" title="Signed in">{user}</span>}
            <nav className="tabs" aria-label="Sections">
              <button className={tab === "hq" ? "tab on" : "tab"} onClick={() => setTab("hq")}>HQ</button>
              <button className={tab === "review" ? "tab on" : "tab"} onClick={() => setTab("review")}>Review</button>
              <button className={tab === "organic" ? "tab on" : "tab"} onClick={() => setTab("organic")}>Organic</button>
              <button className={tab === "onboard" ? "tab on" : "tab"} onClick={() => setTab("onboard")}>Onboard</button>
              <button className={tab === "source" ? "tab on" : "tab"} onClick={() => setTab("source")}>Source</button>
            </nav>
          </div>
        </div>
        <div className="top-actions">
          <div className="scope-toggle">
            <button className={scope === "mine" ? "on" : ""} onClick={() => switchScope("mine")}>My pipeline</button>
            <button className={scope === "all" ? "on" : ""} onClick={() => switchScope("all")}>All team</button>
          </div>
          <button className="ghost" onClick={() => load({ keepPending: pendingCount > 0 })} disabled={loading || syncing}>Reload</button>
          <button className="primary" onClick={sync} disabled={!pendingCount || syncing}>
            {syncing ? "Saving…" : pendingCount ? `Save ${pendingCount} to Notion` : "Nothing to save"}
          </button>
        </div>
      </header>

      {syncMsg && <div className={"banner" + (/failed/i.test(syncMsg) ? " bad" : "")}>{syncMsg}</div>}
      {importToast && (
        <div
          className={"banner toast" + (importToast.bad ? " bad" : "")}
          role="status"
          aria-live="polite"
          onMouseEnter={() => setToastPaused(true)}
          onMouseLeave={() => setToastPaused(false)}
        >
          <span>{importToast.text}</span>
          <button className="icon-btn" onClick={() => setImportToast(null)} aria-label="Dismiss">
            <IconX />
          </button>
        </div>
      )}

      <div className="frame">
        <aside className="rail">
          <div className="eyebrow">FUNNEL</div>
          {displayCounts.map(({ stage, n }) => (
            <div key={stage} className={"stage-row" + (stage === "New" ? " hot" : "")}>
              <span>{stage}</span><b>{n}</b>
            </div>
          ))}
          <p className="hint">A approve · R reject · U undo. Decisions queue locally; Save pushes them all to Notion in one go.</p>
        </aside>

        <main>
          {tab === "review" && (
            <>
              <div className="viewtoggle">
                <button className={view === "one" ? "chip on" : "chip"} onClick={() => setView("one")}>One by one</button>
                <button className={view === "browse" ? "chip on" : "chip"} onClick={() => setView("browse")}>Browse all</button>
                <button className="chip" style={{ marginLeft: "auto" }} onClick={() => { setDmDraft(dmTpl || DEFAULT_DM); setDmErr(null); setDmOpen(true); }}>
                  Edit my DM
                </button>
              </div>

              {loading && (
                <div className="skeleton-wrap" aria-label="Loading">
                  <div className="sk sk-card" />
                </div>
              )}
              {!loading && error && <div className="error">{error}</div>}

              {!loading && !error && view === "browse" && (
                <div>
                  {queue.length === 0 && <div className="empty card"><div className="empty-title">Nothing to browse</div></div>}
                  {queue.length > 0 && (
                    <div className="browse-list">
                      {queue.map((c) => {
                        const verdict = pending[c.id];
                        return (
                          <div key={c.id} className={"browse-row" + (verdict === "Approved" ? " ok" : verdict === "Rejected" ? " no" : "")}>
                            <div className="browse-main">
                              <a href={c.link || "#"} target="_blank" rel="noreferrer" className="browse-name">{c.name || c.handle} <IconExt width={12} height={12} /></a>
                              <span className="mono soft browse-meta">{c.handle} · {fmt(c.followers)} followers · {fmt(c.views)} views{scope === "all" && c.owner ? ` · ${c.owner}` : ""}</span>
                            </div>
                            {c.niche?.includes("ugc") && <span className="ugc-chip">🎯</span>}
                            <span className="mini-stamp mono">{c.score ?? "–"}</span>
                            {verdict ? (
                              <button className="ghost small" onClick={() => setPending((p) => { const n = { ...p }; delete n[c.id]; return n; })}>{verdict} · undo</button>
                            ) : (
                              <span className="rowbtns">
                                <button className="approve small" aria-label="Approve" onClick={() => setPending((p) => ({ ...p, [c.id]: "Approved" }))}><IconCheck /></button>
                                <button className="reject small" aria-label="Reject" onClick={() => setPending((p) => ({ ...p, [c.id]: "Rejected" }))}><IconX /></button>
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="hint">Tap a name to open their TikTok and scroll their videos, then decide here. Save pushes everything to Notion in one go.</p>
                </div>
              )}

              {!loading && !error && view === "one" && (<>
                {!current && (
                  <div className="empty card">
                    <div className="empty-title">{pendingCount ? "Queue reviewed" : "Queue clear"}</div>
                    <div className="soft">{pendingCount ? "Press Save to push these decisions to Notion." : "No candidates waiting. The next sourcing run refills this queue."}</div>
                    {!pendingCount && (
                      <button className="primary empty-cta" onClick={() => setTab("source")}>
                        Launch a sourcing run <IconExt />
                      </button>
                    )}
                  </div>
                )}
                {current && (
                  <article className="card">
                    <div className="card-head">
                      <div>
                        <div className="name">{current.name || current.handle}</div>
                        <div className="mono soft">{current.handle} · {current.platform} · {remaining.length} left in queue{scope === "all" && current.owner ? ` · ${current.owner}` : ""}</div>
                        {current.niche?.filter((n) => n !== "ugc").length > 0 && (
                          <div className="niche-row">
                            {current.niche.filter((n) => n !== "ugc").map((n) => (
                              <span key={n} className="niche-chip">{n}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        <div className="score-stamp"><span>{current.score ?? "–"}</span><label>FIT</label></div>
                        {current.niche?.includes("ugc") && <span className="ugc-chip">🎯 UGC-ready</span>}
                      </div>
                    </div>
                    <div className="stats">
                      <div><b className="mono">{fmt(current.followers)}</b><label>FOLLOWERS</label></div>
                      <div><b className="mono">{fmt(current.views)}</b><label>VIEWS (SOURCED VIDEO)</label></div>
                    </div>
                    <div className="body">
                      <div className="eyebrow">WHY IT SCORED THIS WAY</div>
                      <p>{current.rationale || "No rationale recorded."}</p>
                      {current.notes && <p className="soft">{current.notes}</p>}
                      {current.email && (
                        <p className="email-line mono">
                          ✉ {current.email}
                          {/talent|management|agency|underscore|undercurrent|unitedtalent/i.test(current.email) && <span className="soft"> (agency — likely a managed creator)</span>}
                        </p>
                      )}
                    </div>
                    <div className="actions">
                      <a className="watch" href={current.link || "#"} target="_blank" rel="noreferrer">View their profile <IconExt /></a>
                      <button className="approve" onClick={() => decide("Approved")}>Approve</button>
                      <button className="reject" onClick={() => decide("Rejected")}>Reject</button>
                      <button className="ghost" onClick={() => copy("dm", dmFor(firstNameOf(current.name)))}>
                        {copiedKey === "dm" ? "Copied ✓" : "Copy outreach DM"}
                      </button>
                      {current.email && (
                        <a
                          className="ghost"
                          href={mailtoLink(current.email, dmFor(firstNameOf(current.name)))}
                          target="_blank" rel="noreferrer"
                          onClick={() => copy("emaildm", dmFor(firstNameOf(current.name)))}
                        >
                          {copiedKey === "emaildm" ? "Email opened · DM copied ✓" : "Email + copy DM"}
                        </a>
                      )}
                      {pendingCount > 0 && <button className="ghost" onClick={undo}>Undo</button>}
                    </div>
                  </article>
                )}
                <p className="hint">Judge with your own eyes before approving: open the profile and watch two or three videos. The score only measures what a scraper can see.</p>
              </>)}
            </>
          )}

          {tab === "source" && <SourceTab scope={scope} refreshKey={importsVersion} onImported={() => load({ keepPending: pendingCount > 0 })} />}

          {tab === "organic" && <OrganicTab onImported={() => load({ keepPending: pendingCount > 0 })} />}

          {tab === "hq" && (loading ? (
            <div className="hq-grid" aria-label="Loading">
              <div className="sk sk-panel" />
              <div className="sk sk-panel" />
              <div className="sk sk-panel" />
            </div>
          ) : <HqTab counts={counts} weekly={weekly} scope={scope} team={team} user={user} />)}


          {tab === "onboard" && (
            <>
              {loading && (
                <div className="skeleton-wrap" aria-label="Loading">
                  <div className="sk sk-row" />
                  <div className="sk sk-row" />
                  <div className="sk sk-row" />
                  <div className="sk sk-row" />
                </div>
              )}
              {!loading && !error && roster.length === 0 && (
                <div className="empty card">
                  <div className="empty-title">Nobody in play yet</div>
                  <div className="soft">Approve candidates in Review and they&apos;ll appear here with the right resources for each stage.</div>
                  <button className="primary empty-cta" onClick={() => setTab("review")}>
                    Go to Review <IconExt />
                  </button>
                </div>
              )}
              {!loading && !error && roster.length > 0 && (
                <>
                <div className="onboard-tools">
                  <input
                    className="input"
                    placeholder="Search creators…"
                    value={onboardSearch}
                    onChange={(e) => setOnboardSearch(e.target.value)}
                  />
                  {["All", ...ONBOARD_STAGES].map((s) => (
                    <button key={s} className={"chip" + (onboardStage === s ? " on" : "")} onClick={() => setOnboardStage(s)}>
                      {s}
                    </button>
                  ))}
                </div>
                {scope === "all" && (
                  <div className="onboard-tools" style={{ marginTop: -6 }}>
                    <span className="eyebrow" style={{ marginRight: 2 }}>OWNER</span>
                    {["All", ...team].map((o) => (
                      <button key={o} className={"chip" + (onboardOwner === o ? " on" : "")} onClick={() => setOnboardOwner(o)}>
                        {o === "All" ? "All" : o[0].toUpperCase() + o.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="onboard-grid">
                  <div className="roster">
                    {ONBOARD_STAGES.filter((stage) => onboardStage === "All" || onboardStage === stage).map((stage) => {
                      const q = onboardSearch.trim().toLowerCase();
                      const members = roster.filter(
                        (c) =>
                          stageOf(c) === stage &&
                          (scope !== "all" || onboardOwner === "All" || (c.owner || "lucas") === onboardOwner) &&
                          (!q || (c.name || "").toLowerCase().includes(q) || (c.handle || "").toLowerCase().includes(q))
                      );
                      if (!members.length) return null;
                      return (
                        <div key={stage}>
                          <div className="roster-head"><span>{stage.toUpperCase()}</span><span>{members.length}</span></div>
                          {members.map((c) => (
                            <button key={c.id} className={"roster-row" + (selected === c.id ? " on" : "")} onClick={() => setSelected(c.id)}>
                              <span className="rname">{c.name || c.handle}</span>
                              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                {scope === "all" && <span className="owner-tag">{(c.owner || "lucas")[0].toUpperCase()}</span>}
                                <span className="badge">{stageOf(c)}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  <div className="stagework">
                    {!selected && <div className="soft" style={{ padding: 20 }}>Pick a creator to see the playbook for their stage.</div>}
                    {selected && (() => {
                      const c = roster.find((r) => r.id === selected);
                      if (!c) return null;
                      const stage = stageOf(c);
                      const first = firstNameOf(c.name);
                      return (
                        <div>
                          <div className="card-head" style={{ padding: "0 0 12px" }}>
                            <div>
                              <div className="name">{c.name || c.handle}</div>
                              <a className="mono soft" href={c.link || "#"} target="_blank" rel="noreferrer">{c.handle} <IconExt width={12} height={12} /></a>
                            </div>
                            {stage !== "Rejected" && (
                              <button className="reject small" onClick={() => moveStage(c, "Rejected")}>
                                <IconX /> Remove
                              </button>
                            )}
                          </div>
                          {stage === "Rejected" ? (
                            <div className="pack">
                              <div className="eyebrow" style={{ color: "#FF6B5E" }}>QUEUED FOR REMOVAL</div>
                              <p className="soft">
                                Press Save (top right) to confirm — they&apos;ll leave the pipeline as Rejected,
                                and the scraper can never re-import them. Changed your mind?
                              </p>
                              <button className="ghost" onClick={() => setPending((p) => { const n = { ...p }; delete n[c.id]; return n; })}>
                                Undo removal
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="stepper">
                                {ONBOARD_STAGES.map((s) => (
                                  <button key={s} className={"chip" + (s === stage ? " on" : "")} onClick={() => moveStage(c, s)}>{s}</button>
                                ))}
                              </div>
                              <StagePack stage={stage} first={first} email={c.email} copy={copy} copiedKey={copiedKey} dmFor={dmFor} />
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {fallbackText && (
        <div className="modal-back" role="dialog" aria-label="Copy manually">
          <div className="modal">
            <div className="eyebrow">CLIPBOARD BLOCKED — SELECT AND COPY MANUALLY</div>
            <textarea readOnly value={fallbackText} onFocus={(e) => e.target.select()} autoFocus />
            <button className="primary" onClick={() => setFallbackText(null)}>Done</button>
          </div>
        </div>
      )}

      {dmOpen && (
        <div className="modal-back" onClick={() => setDmOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">MY OUTREACH DM ({(user || "me").toUpperCase()})</div>
            <p className="soft" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
              This is what your Copy outreach DM and email buttons send. Write <span className="mono">{"{first}"}</span>{" "}
              wherever the creator&apos;s first name should go (becomes &quot;there&quot; when we don&apos;t have one).
              Keep blank lines between paragraphs — they survive the copy.
            </p>
            <textarea value={dmDraft} onChange={(e) => setDmDraft(e.target.value)} />
            {dmErr && <div className="banner bad" style={{ borderRadius: 10 }}>{dmErr}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="ghost" onClick={() => setDmDraft(DEFAULT_DM)}>Reset to company default</button>
              <button className="ghost" onClick={() => setDmOpen(false)}>Cancel</button>
              <button className="primary" onClick={saveDm} disabled={dmSaving || !dmDraft.trim()}>
                {dmSaving ? "Saving…" : "Save my DM"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StagePack({ stage, first, email, copy, copiedKey, dmFor }) {
  const L = ({ href, children }) => <a className="res" href={href} target="_blank" rel="noreferrer">{children} <IconExt width={12} height={12} /></a>;
  const C = ({ k, text, children }) => (
    <button className="res copybtn" onClick={() => copy(k, text)}>{copiedKey === k ? "Copied ✓" : children}</button>
  );
  if (stage === "Approved") return (
    <div className="pack">
      <div className="eyebrow">NEXT MOVE: SEND THE DM{email ? " + EMAIL" : ""}</div>
      <p className="soft">Follow them on TikTok first, then DM from your account — your personal template, editable under Review → Edit my DM.{email ? " They list an email too — reaching out on both channels lifts reply rates." : ""}</p>
      <C k="p-dm" text={dmFor(first)}>Copy outreach DM</C>
      {email && (
        <a className="res copybtn" style={{ display: "block" }} href={mailtoLink(email, dmFor(first))} target="_blank" rel="noreferrer" onClick={() => copy("p-emaildm", dmFor(first))}>
          {copiedKey === "p-emaildm" ? "Email opened · DM copied ✓" : `Email ${email} + copy DM`}
        </a>
      )}
      <L href={LINKS.messageBank}>Outreach Message Bank</L>
      <p className="soft">Once sent, move them to Contacted and Save.</p>
    </div>
  );
  if (stage === "Contacted") return (
    <div className="pack">
      <div className="eyebrow">WAITING ON A REPLY</div>
      <p className="soft">When they reply, move to Replied. If nothing after ~5 days, one polite bump from the Message Bank, then let it go.</p>
      <L href={LINKS.messageBank}>Outreach Message Bank</L>
    </div>
  );
  if (stage === "Replied") return (
    <div className="pack">
      <div className="eyebrow">BOOK THE INTERVIEW</div>
      <p className="soft">Answer their questions, share your booking link. You can interview multiple creators in one call to save time.</p>
      <L href={LINKS.interviewChecklist}>Interview Checklist</L>
      <L href={LINKS.interviewSlides}>Interview slides (make your own copy)</L>
    </div>
  );
  if (stage === "Interview") return (
    <div className="pack">
      <div className="eyebrow">RUN THE CALL</div>
      <C k="p-intro" text={INTERVIEW_INTRO}>Copy intro script + non-compete check</C>
      <C k="p-close" text={INTERVIEW_CLOSE}>Copy closing script</C>
      <L href={LINKS.interviewSlides}>Interview slides</L>
      <p className="soft">Get their full name in the chat before the call ends — you need it for the contract. Then move them to Signed and run onboarding immediately.</p>
    </div>
  );
  // Signed: the onboarding pack
  return (
    <div className="pack">
      <div className="eyebrow">SIGNED — ONBOARD NOW, RIGHT AFTER THE CALL</div>
      <div className="packsec">1 · Tracker</div>
      <p className="soft">Add a row with full name + all fields. Assign the team lead with the smaller column (Chart view), matching postgrad vs undergrad fit. Leave the tax column to Alba.</p>
      <L href={LINKS.tracker}>Creator Tracker</L>
      <div className="packsec">2 · Contract</div>
      <C k="p-contract" text={CONTRACT_STEPS}>Copy contract steps</C>
      <L href={LINKS.contractTemplate}>Contract template</L>
      <div className="packsec">3 · IG chat</div>
      <C k="p-igsetup" text={IG_SETUP}>Copy chat setup steps</C>
      <C k="p-igmsg" text={igWelcome(first)}>Copy welcome message</C>
      <L href={LINKS.celebrationsChat}>Celebrations chat link</L>
      <L href={LINKS.announcementsChat}>Announcements chat link</L>
      <div className="packsec">4 · Email</div>
      <C k="p-email" text={welcomeEmail(first)}>Copy welcome email (CC alba@anara.com)</C>
      <div className="packsec">Reference</div>
      <L href={LINKS.onboardingChecklist}>Onboarding Checklist</L>
      <L href={LINKS.demoGuide}>Product demo guide</L>
      <L href={LINKS.guide}>Full hiring guide</L>
      <p className="soft">They join the weekly Tuesday group meeting after their trial week.</p>
    </div>
  );
}
