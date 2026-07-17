"use client";

import { useState, useEffect, useCallback } from "react";

// The tracking hub — the only team-wide surface. Day / Week / Month pages
// (step back through history with the arrows), each showing the goal, the
// Approved→Signed funnel, a per-account table, and the all-time pipeline.
// My stats vs Team stats is the only place that toggle lives now.

const FUNNEL = [
  ["approved", "Approved"],
  ["contacted", "Contacted"],
  ["replied", "Replied"],
  ["interview", "Interview"],
  ["signed", "Signed"],
];
const ALL_TIME_STAGES = ["New", "Approved", "Contacted", "Replied", "Interview", "Signed", "Rejected"];
const PERIODS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];

// "Today" / "This week" etc. when current, "Yesterday" / "Last week" at -1
const REL = {
  day: { 0: "Today", "-1": "Yesterday" },
  week: { 0: "This week", "-1": "Last week" },
  month: { 0: "This month", "-1": "Last month" },
};

export default function HqTab({ user: initialUser, team: initialTeam }) {
  const [period, setPeriod] = useState("week");
  const [offset, setOffset] = useState(0);
  const [scope, setScope] = useState("mine");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/hq?period=${period}&offset=${offset}&scope=${scope}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || `Request failed (${res.status})`);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }, [period, offset, scope]);

  useEffect(() => { load(); }, [load]);

  // Switching period resets to the current window (offsets don't map across day/week/month)
  const pickPeriod = (p) => { setPeriod(p); setOffset(0); };

  const team = data?.team || initialTeam || [];
  const me = data?.user || initialUser;
  const f = data?.funnel || {};
  const goal = data?.goal || 1;
  const signed = data?.signed || 0;
  const pct = Math.min(100, Math.round((signed / goal) * 100));
  const maxBar = Math.max(1, ...FUNNEL.map(([k]) => f[k] || 0));
  const allTime = data?.allTime || {};
  const allTimeMax = Math.max(1, ...ALL_TIME_STAGES.map((s) => allTime[s] || 0));
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
        <div className="hq-grid">
          <div className="sk sk-panel" /><div className="sk sk-panel" />
          <div className="sk sk-panel" /><div className="sk sk-panel" />
        </div>
      ) : (
        <div className="hq-grid" style={loading ? { opacity: 0.55 } : undefined}>
          <div className="card hq-goal">
            <div className="eyebrow">{scope === "all" ? "TEAM GOAL" : "MY GOAL"} · {(rel || data?.label || "").toUpperCase()}</div>
            <div className="hq-goal-num">
              <b className="mono">{signed}</b>
              <span className="soft">/ {goal} signed</span>
            </div>
            <div className="hq-goal-track"><div className="hq-goal-fill" style={{ width: `${pct}%` }} /></div>
            <p className="soft" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
              {signed >= goal
                ? "Goal hit — anything more is gravy. 🎉"
                : `${goal - signed} to go${scope === "all" ? ` · ${data?.goalPerPerson} per person` : ""}`}
            </p>
          </div>

          <div className="card hq-panel">
            <div className="eyebrow">FUNNEL · {(rel || data?.label || "").toUpperCase()}</div>
            <div className="hq-funnel">
              {FUNNEL.map(([k, label]) => (
                <div key={k} className="hq-frow">
                  <span className="hq-flabel">{label}</span>
                  <div className="hq-fbars"><div className="hq-fbar now" style={{ width: `${((f[k] || 0) / maxBar) * 100}%` }} /></div>
                  <span className="mono hq-fnums"><b>{f[k] || 0}</b></span>
                </div>
              ))}
            </div>
            <p className="soft" style={{ fontSize: 11.5, margin: "10px 0 0" }}>counted from status changes saved in the app</p>
          </div>

          <div className="card hq-panel" style={{ gridColumn: "1 / -1" }}>
            <div className="eyebrow">BY TEAM MEMBER · {(rel || data?.label || "").toUpperCase()}</div>
            <div className="hq-acct-scroll">
              <div className="hq-acct hq-acct-head">
                <span></span>
                {FUNNEL.map(([k, label]) => <span key={k} className="mono">{label.toLowerCase()}</span>)}
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

          <div className="card hq-panel" style={{ gridColumn: "1 / -1" }}>
            <div className="eyebrow">ALL-TIME PIPELINE{scope === "all" ? " · WHOLE TEAM" : " · MINE"}</div>
            <div className="hq-funnel">
              {ALL_TIME_STAGES.map((s) => (
                <div key={s} className="hq-frow">
                  <span className="hq-flabel">{s}</span>
                  <div className="hq-fbars"><div className="hq-fbar all" style={{ width: `${((allTime[s] || 0) / allTimeMax) * 100}%` }} /></div>
                  <span className="mono hq-fnums"><b>{allTime[s] || 0}</b></span>
                </div>
              ))}
            </div>
          </div>
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
