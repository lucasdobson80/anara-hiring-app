"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { stageLabel } from "@/lib/templates";

// The tracking hub — the only team-wide surface. Day / Week / Month pages
// (step back through history with the arrows), each showing the goal, the
// Approved→Signed funnel, and — under Team stats — a per-account table.
// My stats vs Team stats is the only place that toggle lives now.

const FUNNEL = [
  ["contacted", "Contacted"],
  ["replied", "Replied"],
  ["interview", "Interview"],
  ["signed", "Signed"],
];
const PERIODS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];

// "Today" / "This week" etc. when current, "Yesterday" / "Last week" at -1
const REL = {
  day: { 0: "Today", "-1": "Yesterday" },
  week: { 0: "This week", "-1": "Last week" },
  month: { 0: "This month", "-1": "Last month" },
};

export default function HqTab({ user: initialUser, team: initialTeam, track = "creator" }) {
  const [period, setPeriod] = useState("week");
  const [offset, setOffset] = useState(0);
  const [scope, setScope] = useState("mine");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Guard against a slow older fetch overwriting a newer one — the period,
  // offset, scope, and track controls are all rapidly clickable.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/hq?period=${period}&offset=${offset}&scope=${scope}&track=${track}`);
      const d = await res.json();
      if (seq !== loadSeq.current) return;
      if (!res.ok) throw new Error(d.message || `Request failed (${res.status})`);
      setData(d);
    } catch (e) {
      if (seq === loadSeq.current) setError(e.message);
    } finally { if (seq === loadSeq.current) setLoading(false); }
  }, [period, offset, scope, track]);

  useEffect(() => { load(); }, [load]);

  // Switching period resets to the current window (offsets don't map across day/week/month)
  const pickPeriod = (p) => { setPeriod(p); setOffset(0); };

  const team = data?.team || initialTeam || [];
  const me = data?.user || initialUser;
  const f = data?.funnel || {};
  const goal = data?.goal || 1;
  const signed = data?.signed || 0;
  const pct = Math.min(100, Math.round((signed / goal) * 100));
  const rel = REL[period]?.[String(offset)];

  return (
    <div>
      <div className="hq-controls">
        <div className="viewtoggle" style={{ margin: 0 }}>
          {PERIODS.map(([p, label]) => (
            <button key={p} className={period === p ? "chip on" : "chip"} onClick={() => pickPeriod(p)}>{label}</button>
          ))}
        </div>
        <div className="hq-period-nav">
          <button className="ghost tiny" aria-label="Previous" onClick={() => setOffset((o) => o - 1)}>‹</button>
          <span className="hq-period-label mono">{data?.label || "…"}{rel ? <span className="soft"> · {rel}</span> : null}</span>
          <button className="ghost tiny" aria-label="Next" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))}>›</button>
        </div>
        <div className="scope-toggle" style={{ marginLeft: "auto" }}>
          <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>My stats</button>
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Team stats</button>
        </div>
      </div>

      {error && <div className="banner bad" style={{ borderRadius: 10, marginBottom: 14 }}>{error}</div>}

      {loading && !data ? (
        <div className="kpi-row">
          <div className="sk sk-bar" /><div className="sk sk-bar" />
          <div className="sk sk-bar" /><div className="sk sk-bar" /><div className="sk sk-bar" />
        </div>
      ) : (
        <div style={loading ? { opacity: 0.55 } : undefined}>
          {/* KPI stat tiles: goal first (accent-ringed), then one per stage */}
          <div className="kpi-row">
            {/* Researchers have no goal — Laia's track tracks activity only */}
            {track !== "researcher" && (
              <div className="kpi goal">
                <div className="kpi-label">{scope === "all" ? "Team goal" : "My goal"} · {rel || data?.label || ""}</div>
                <div className="kpi-num">{signed} <span className="kpi-sub">/ {goal} onboarded</span></div>
                <div className="hq-goal-track"><div className="hq-goal-fill" style={{ width: `${pct}%` }} /></div>
                <div className="kpi-note">
                  {signed >= goal
                    ? "Goal hit — anything more is gravy 🎉"
                    : `${goal - signed} to go${scope === "all" ? ` · ${data?.goalPerPerson} per person` : ""}`}
                </div>
              </div>
            )}
            {FUNNEL.map(([k, label]) => (
              <div key={k} className="kpi">
                <div className="kpi-label">{stageLabel(label)}</div>
                <div className="kpi-num">{f[k] || 0}</div>
              </div>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>counted from status changes saved in the app · {rel || data?.label || ""}</p>

          {scope === "all" && (
            <div className="card hq-panel" style={{ marginTop: 16 }}>
              <div className="eyebrow">By team member · {rel || data?.label || ""}</div>
              <div className="hq-acct-scroll">
                <div className="hq-acct hq-acct-head">
                  <span></span>
                  {FUNNEL.map(([k, label]) => <span key={k} style={{ textAlign: "right" }}>{stageLabel(label)}</span>)}
                </div>
                {team.map((m) => (
                  <div key={m} className={"hq-acct" + (m === me ? " me" : "")}>
                    <span style={{ textTransform: "capitalize" }}>{m}</span>
                    {FUNNEL.map(([k]) => (
                      <span key={k} className={"mono" + (k === "signed" ? " strong" : "")}>{data?.perOwner?.[m]?.[k] ?? 0}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="hint">
        Numbers count each creator once per stage, stamped when a status is saved — history before the tracker
        shipped (11 Jul) isn&apos;t dated, so counts build from there. Use the arrows to step back through past{" "}
        {period === "day" ? "days" : period === "month" ? "months" : "weeks"}.
      </p>
    </div>
  );
}
