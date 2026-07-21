"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  STAGES, ONBOARD_STAGES, LINKS,
  firstNameOf, renderDm, DEFAULT_MESSAGES, mailtoLink, stageLabel, htmlToText, cleanEmailHtml,
  INTERVIEW_INTRO, INTERVIEW_CLOSE,
} from "@/lib/templates";
import SourceTab from "./source-tab";
import OrganicTab from "./organic-tab";
import HqTab from "./hq-tab";
import MessagesTab from "./messages-tab";
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
  // Rich copy — writes HTML so links + bullets survive a paste into Gmail,
  // with a plain-text alternative for plain targets.
  const copyRich = async (key, html, plain) => {
    let ok = false;
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      })]);
      ok = true;
    } catch { ok = false; }
    if (!ok) { try { await navigator.clipboard.writeText(plain); ok = true; } catch { ok = false; } }
    if (ok) { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1600); }
    else setFallbackText(plain);
  };
  return { copy, copyRich, copiedKey, fallbackText, setFallbackText };
}

// ---- signing wizard state (per creator, kept in localStorage) ----
const SIGN_STEPS = ["contract", "tracker", "groupchats", "email"];
const readSign = (id) => { try { return JSON.parse(localStorage.getItem("cd_sign_" + id) || "{}"); } catch { return {}; } };
const writeSign = (id, v) => { try { localStorage.setItem("cd_sign_" + id, JSON.stringify(v)); } catch {} };

export default function AnaraCastingDesk() {
  const [tab, setTab] = useState("hq");
  const [queue, setQueue] = useState([]);
  const [roster, setRoster] = useState([]);
  const [counts, setCounts] = useState({});
  const [view, setView] = useState("one"); // "one" | "browse"
  const [selected, setSelected] = useState(null);
  const [onboardSearch, setOnboardSearch] = useState("");
  const [onboardStage, setOnboardStage] = useState("All");
  const [showStale, setShowStale] = useState(false); // Contacted, no reply >2wk
  const [user, setUser] = useState(null);
  const [team, setTeam] = useState(["lucas", "laia", "alba"]);
  const [track, setTrack] = useState("creator"); // "creator" (UGC) | "researcher"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [pending, setPending] = useState({}); // pageId -> new status
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const { copy, copyRich, copiedKey, fallbackText, setFallbackText } = useCopy();

  // Personal message bank ({first} token) — the Outreach DM and Welcome email
  // here feed the Review / Onboard buttons. Managed on the Messages tab.
  const [messages, setMessages] = useState(DEFAULT_MESSAGES);
  useEffect(() => {
    fetch("/api/settings/messages").then((r) => r.json()).then((d) => { if (d.messages) setMessages(d.messages); }).catch(() => {});
  }, []);
  const dmFor = useCallback((first) => renderDm(messages["Outreach DM"], first), [messages]);
  const welcomeFor = useCallback((first) => renderDm(messages["Welcome email"], first), [messages]);

  // Review + Onboard show your OWN pipeline in the active track (team view
  // lives in HQ). Restore the remembered track before the first fetch.
  useEffect(() => {
    try { const t = localStorage.getItem("cd_track"); if (t === "researcher" || t === "creator") setTrack(t); } catch {}
  }, []);
  const loadSeq = useRef(0);
  const load = useCallback(async ({ keepPending = false } = {}) => {
    const seq = ++loadSeq.current;
    setLoading(true); setError(null); setNeedsSetup(false);
    try {
      const res = await fetch(`/api/pipeline?track=${track}`);
      const data = await res.json();
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        if (data.error === "setup") { setNeedsSetup(true); return; }
        throw new Error(data.message || `Request failed (${res.status})`);
      }
      setQueue(data.queue);
      setRoster(data.roster);
      setCounts(data.counts);
      if (data.user) setUser(data.user);
      if (data.team) setTeam(data.team);
      if (!keepPending) setPending({});
      setSelected((s) => (data.roster.some((r) => r.id === s) ? s : null));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError("Couldn't load the pipeline from Notion. " + e.message + " — press Reload to retry.");
    } finally { if (seq === loadSeq.current) setLoading(false); }
  }, [track]);

  useEffect(() => { load(); }, [load]);

  const switchTrack = (t) => {
    if (t === track) return;
    setTrack(t);
    try { localStorage.setItem("cd_track", t); } catch {}
    setSelected(null);
    setPending({});
    // load() refetches automatically (track is a dep of the load callback)
  };

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

  // Signing-wizard progress (localStorage); signVer forces a re-read on change
  const [signVer, setSignVer] = useState(0);
  const bumpSign = () => setSignVer((v) => v + 1);
  const signProgress = (id) => {
    void signVer; // re-read whenever a step is toggled
    const s = readSign(id);
    return { done: SIGN_STEPS.filter((k) => s[k]).length, total: SIGN_STEPS.length };
  };
  const appendOnboardNote = async (id) => {
    try {
      await fetch("/api/onboard-note", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: id }),
      });
    } catch { /* best-effort — the checklist state is the source of truth */ }
  };

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

  // Nav + track switcher render in two places (sidebar on desktop, top bar on
  // mobile) — functions so each spot gets its own element instances.
  const renderNav = () => (
    <>
      <button className={tab === "hq" ? "tab on" : "tab"} onClick={() => setTab("hq")}>HQ</button>
      <span className="tab-group">
        <span className="tab-group-label">PIPELINE</span>
        <button className={tab === "organic" ? "tab on" : "tab"} onClick={() => setTab("organic")}>Organic</button>
        <button className={tab === "onboard" ? "tab on" : "tab"} onClick={() => setTab("onboard")}>Onboard</button>
      </span>
      <span className="tab-group">
        <span className="tab-group-label">FIND</span>
        <button className={tab === "source" ? "tab on" : "tab"} onClick={() => setTab("source")}>Source</button>
        <button className={tab === "review" ? "tab on" : "tab"} onClick={() => setTab("review")}>Review</button>
      </span>
      <button className={tab === "messages" ? "tab on" : "tab"} onClick={() => setTab("messages")}>Messages</button>
    </>
  );
  const renderTrackSwitch = () => (
    <div className="track-switch">
      <button className={track === "creator" ? "on" : ""} onClick={() => switchTrack("creator")}>🎬 UGC Creators</button>
      <button className={track === "researcher" ? "on" : ""} onClick={() => switchTrack("researcher")}>🔬 Researchers</button>
    </div>
  );

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
          </div>
        </div>
        <div className="top-actions">
          <button className="ghost" onClick={() => load({ keepPending: pendingCount > 0 })} disabled={loading || syncing}>Reload</button>
          <button className="primary" onClick={sync} disabled={!pendingCount || syncing}>
            {syncing ? "Saving…" : pendingCount ? `Save ${pendingCount} to Notion` : "Nothing to save"}
          </button>
        </div>
      </header>

      {/* Mobile-only nav (sidebar hides ≤900px): track switch + tabs */}
      <div className="mobile-nav">
        {renderTrackSwitch()}
        <nav className="tabs" aria-label="Sections">{renderNav()}</nav>
      </div>

      {syncMsg && <div className={"banner" + (/failed/i.test(syncMsg) ? " bad" : "")}>{syncMsg}</div>}

      <div className="frame">
        <aside className="sidebar">
          {renderTrackSwitch()}
          <nav className="side-nav" aria-label="Sections">{renderNav()}</nav>
          <div className="side-funnel">
            <div className="eyebrow">{track === "researcher" ? "RESEARCHER FUNNEL" : "FUNNEL"}</div>
            {displayCounts.filter(({ stage }) => stage !== "Approved" && stage !== "Rejected").map(({ stage, n }) => (
              <div key={stage} className={"stage-row" + (stage === "New" ? " hot" : "")}>
                <span>{stageLabel(stage)}</span><b>{n}</b>
              </div>
            ))}
          </div>
          <p className="hint">A approve · R reject · U undo. Decisions queue locally; Save pushes them all to Notion in one go.</p>
        </aside>

        <main>
          {tab === "review" && (
            <>
              <div className="viewtoggle">
                <button className={view === "one" ? "chip on" : "chip"} onClick={() => setView("one")}>One by one</button>
                <button className={view === "browse" ? "chip on" : "chip"} onClick={() => setView("browse")}>Browse all</button>
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
                              <span className="mono soft browse-meta">{c.handle}{c.platform === "LinkedIn" ? ` · ${fmt(c.followers)} connections` : ` · ${fmt(c.followers)} followers · ${fmt(c.views)} views`}</span>
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
                  <p className="hint">{track === "researcher" ? "Tap a name to open their LinkedIn, then decide here." : "Tap a name to open their TikTok and scroll their videos, then decide here."} Save pushes everything to Notion in one go.</p>
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
                        <div className="mono soft">{current.handle} · {current.platform} · {remaining.length} left in queue</div>
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
                      <div><b className="mono">{fmt(current.followers)}</b><label>{current.platform === "LinkedIn" ? "CONNECTIONS" : "FOLLOWERS"}</label></div>
                      {current.platform !== "LinkedIn" && <div><b className="mono">{fmt(current.views)}</b><label>VIEWS (SOURCED VIDEO)</label></div>}
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
                <p className="hint">{track === "researcher" ? "Open their LinkedIn and skim the profile before approving. The score only measures what the scraper can see." : "Judge with your own eyes before approving: open the profile and watch two or three videos. The score only measures what a scraper can see."}</p>
              </>)}
            </>
          )}

          {tab === "source" && <SourceTab track={track} onImported={() => load({ keepPending: pendingCount > 0 })} />}

          {tab === "organic" && <OrganicTab track={track} onImported={() => load({ keepPending: pendingCount > 0 })} />}

          {tab === "hq" && <HqTab team={team} user={user} track={track} />}

          {tab === "messages" && <MessagesTab messages={messages} onSaved={setMessages} user={user} copy={copy} copyRich={copyRich} copiedKey={copiedKey} />}


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
                      {stageLabel(s)}
                    </button>
                  ))}
                </div>
                <div className="onboard-grid">
                  <div className="roster">
                    {ONBOARD_STAGES.filter((stage) => onboardStage === "All" || onboardStage === stage).map((stage) => {
                      const q = onboardSearch.trim().toLowerCase();
                      const members = roster.filter(
                        (c) =>
                          stageOf(c) === stage &&
                          (!q || (c.name || "").toLowerCase().includes(q) || (c.handle || "").toLowerCase().includes(q))
                      );
                      if (!members.length) return null;
                      const rowOf = (c) => {
                        const prog = stage === "Signed" ? signProgress(c.id) : null;
                        return (
                          <button key={c.id} className={"roster-row" + (selected === c.id ? " on" : "")} onClick={() => setSelected(c.id)}>
                            <span className="rname">{c.name || c.handle}</span>
                            <span className="roster-tags">
                              {prog && <span className={"sign-badge" + (prog.done === prog.total ? " full" : "")}>{prog.done === prog.total ? "✓ set up" : `${prog.done}/${prog.total}`}</span>}
                              <span className="badge">{stageLabel(stageOf(c))}</span>
                            </span>
                          </button>
                        );
                      };
                      // Contacted with no reply for 2+ weeks tucks away — still
                      // in the system, just hidden until they move stage.
                      if (stage === "Contacted") {
                        const isStale = (c) => {
                          const ref = c.contactedAt || c.lastEdited;
                          return ref && Date.now() - Date.parse(ref) >= 14 * 86400000;
                        };
                        const fresh = members.filter((c) => !isStale(c));
                        const stale = members.filter(isStale);
                        return (
                          <div key={stage}>
                            <div className="roster-head"><span>CONTACTED</span><span>{members.length}</span></div>
                            {fresh.map(rowOf)}
                            {stale.length > 0 && (
                              <>
                                <button className="stale-toggle" onClick={() => setShowStale((s) => !s)}>
                                  {showStale ? "▾" : "▸"} No reply · older than 2 weeks ({stale.length})
                                </button>
                                {showStale && stale.map(rowOf)}
                              </>
                            )}
                          </div>
                        );
                      }
                      return (
                        <div key={stage}>
                          <div className="roster-head"><span>{stageLabel(stage).toUpperCase()}</span><span>{members.length}</span></div>
                          {members.map(rowOf)}
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
                                  <button key={s} className={"chip" + (s === stage ? " on" : "")} onClick={() => moveStage(c, s)}>{stageLabel(s)}</button>
                                ))}
                              </div>
                              <StagePack
                                stage={stage} first={first} email={c.email}
                                copy={copy} copyRich={copyRich} copiedKey={copiedKey} dmFor={dmFor}
                                welcomeHtml={welcomeFor(first)}
                                welcomeMsg={renderDm(messages["Welcome message"], first)}
                                contractLink={messages["Contract template link"]}
                                trialLink={messages["Trial videos link"]}
                                signState={readSign(c.id)}
                                onSign={(next) => { writeSign(c.id, next); bumpSign(); }}
                                onOnboarded={() => appendOnboardNote(c.id)}
                              />
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

    </div>
  );
}

function StagePack({ stage, first, email, copy, copyRich, copiedKey, dmFor, welcomeHtml, welcomeMsg, contractLink, trialLink, signState, onSign, onOnboarded }) {
  const L = ({ href, children }) => <a className="res" href={href} target="_blank" rel="noreferrer">{children} <IconExt width={12} height={12} /></a>;
  const C = ({ k, text, children }) => (
    <button className="res copybtn" onClick={() => copy(k, text)}>{copiedKey === k ? "Copied ✓" : children}</button>
  );
  if (stage === "Approved") return (
    <div className="pack">
      <div className="eyebrow">NEXT MOVE: SEND THE DM{email ? " + EMAIL" : ""}</div>
      <p className="soft">Follow them on TikTok first, then DM from your account — your personal template, editable under the Messages tab.{email ? " They list an email too — reaching out on both channels lifts reply rates." : ""}</p>
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
      <p className="soft">Get their full name in the chat before the call ends — you need it for the contract. Then move them to Onboarded and run setup immediately.</p>
    </div>
  );
  // Signed: the onboarding wizard — tick each step as you go; state persists
  // per creator so you can be interrupted and pick up exactly where you left.
  const s = signState || {};
  const steps = [
    { key: "contract", label: "Contract", body: (<>
      <L href={contractLink || LINKS.contractTemplate}>Contract template</L>
    </>) },
    { key: "tracker", label: "Add tracker row", body: (<>
      <L href={LINKS.tracker}>Open Creator Tracker</L>
      <p className="soft" style={{ margin: "4px 0 0", fontSize: 12.5 }}>Full name + all fields; leave the tax column to Alba.</p>
    </>) },
    { key: "groupchats", label: "Group chats", body: (<>
      <C k="p-igmsg" text={welcomeMsg}>Copy welcome message</C>
      {trialLink
        ? <C k="p-trial" text={trialLink}>Copy Trial videos link</C>
        : <p className="soft" style={{ margin: "2px 0", fontSize: 12.5 }}>Set the Trial videos link in Messages</p>}
      <C k="p-celeb" text={LINKS.celebrationsChat}>Copy Celebrations chat link</C>
      <C k="p-announce" text={LINKS.announcementsChat}>Copy Announcements chat link</C>
    </>) },
    { key: "email", label: "Welcome email", body: (<>
      <button className="res copybtn" onClick={() => copyRich("p-email", cleanEmailHtml(welcomeHtml), htmlToText(welcomeHtml))}>
        {copiedKey === "p-email" ? "Copied ✓ — paste into Gmail" : "Copy welcome email"}
      </button>
      {email && <L href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`}>Open Gmail to {email}</L>}
      <p className="soft" style={{ margin: "2px 0", fontSize: 12.5 }}>Add the subject &amp; CC yourself, then paste (Cmd/Ctrl+V) — links &amp; bullets are kept.</p>
    </>) },
  ];
  const done = steps.filter((st) => s[st.key]).length;
  const allDone = done === steps.length;
  const toggle = (key) => onSign({ ...s, [key]: !s[key] });
  return (
    <div className="pack">
      <div className="eyebrow">ONBOARDED — FINISH SETUP ({done}/{steps.length})</div>
      {steps.map((st, i) => (
        <div key={st.key} className={"sign-step" + (s[st.key] ? " done" : "")}>
          <button className="sign-check" onClick={() => toggle(st.key)} aria-label={s[st.key] ? "Mark incomplete" : "Mark done"}>
            {s[st.key] ? <IconCheck /> : <span className="sign-num">{i + 1}</span>}
          </button>
          <div className="sign-body">
            <div className="sign-label">{st.label}</div>
            {st.body}
          </div>
        </div>
      ))}
      {allDone && (
        s.doneNoted ? (
          <p className="soft" style={{ color: "#3ECF8E" }}>✓ Fully onboarded — logged to their Notion page. They join the weekly Tuesday meeting after trial week.</p>
        ) : (
          <button className="primary" style={{ marginTop: 4 }} onClick={() => { onOnboarded(); onSign({ ...s, doneNoted: true }); }}>
            ✓ Mark fully onboarded
          </button>
        )
      )}
      <L href={LINKS.onboardingChecklist}>Full onboarding checklist</L>
    </div>
  );
}
