"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { stageLabel } from "@/lib/templates";

// The tracking hub — the only team-wide surface. Shortimize-style overview:
// a KPI tile row that doubles as the chart's metric selector, a hero area
// chart of daily activity, and (under Team stats) a per-account table.

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

// ── Hero area chart: smooth indigo line + soft fill, y labels right ──
function TrendChart({ series, metric, label }) {
  const W = 860, H = 240, PADL = 10, PADR = 46, PADT = 14, PADB = 26;
  const vals = series.map((p) => p[metric] || 0);
  const max = Math.max(1, ...vals);
  // Nice y ceiling so gridlines land on round numbers
  const step = max <= 4 ? 1 : max <= 8 ? 2 : max <= 20 ? 5 : max <= 40 ? 10 : Math.ceil(max / 4 / 10) * 10;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const x = (i) => PADL + (i / Math.max(1, series.length - 1)) * (W - PADL - PADR);
  const y = (v) => PADT + (1 - v / top) * (H - PADT - PADB);

  // Catmull-Rom → cubic bezier for the Shortimize-style smooth curve
  const path = useMemo(() => {
    if (series.length < 2) return "";
    const pts = vals.map((v, i) => [x(i), y(v)]);
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(vals)]);

  if (!series.length) return null;
  const gridVals = [];
  for (let v = step; v <= top; v += step) gridVals.push(v);
  const fmtDay = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
  // Up to ~6 x labels, always first + last
  const every = Math.max(1, Math.ceil(series.length / 6));
  const flat = vals.every((v) => v === 0);

  return (
    <div className="trend-wrap">
      <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily ${label} trend`}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6E7BFF" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#6E7BFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PADL} x2={W - PADR + 6} y1={y(v)} y2={y(v)} className="trend-grid" />
            <text x={W - PADR + 12} y={y(v) + 4} className="trend-ylabel">{v}</text>
          </g>
        ))}
        {path && <path d={`${path} L ${x(series.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill="url(#trend-fill)" stroke="none" />}
        {path && <path d={path} className="trend-line" fill="none" />}
        {vals.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="9" className="trend-dot-hit">
            <title>{`${fmtDay(series[i].date)} — ${v} ${label.toLowerCase()}`}</title>
          </circle>
        ))}
        {series.map((p, i) => (
          (i % every === 0 || i === series.length - 1) && (
            <text key={p.date} x={x(i)} y={H - 6} className="trend-xlabel" textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}>
              {fmtDay(p.date)}
            </text>
          )
        ))}
      </svg>
      {flat && <div className="trend-empty soft">No {label.toLowerCase()} activity in this window yet.</div>}
    </div>
  );
}

export default function HqTab({ user: initialUser, team: initialTeam, track = "creator" }) {
  const [period, setPeriod] = useState("week");
  const [offset, setOffset] = useState(0);
  const [scope, setScope] = useState("mine");
  const [metric, setMetric] = useState("contacted");
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
  const metricLabel = stageLabel(FUNNEL.find(([k]) => k === metric)?.[1] || "Contacted");

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
        <div className="skeleton-wrap">
          <div className="kpi-row">
            <div className="sk sk-bar" /><div className="sk sk-bar" />
            <div className="sk sk-bar" /><div className="sk sk-bar" /><div className="sk sk-bar" />
          </div>
          <div className="sk sk-panel" />
        </div>
      ) : (
        <div style={loading ? { opacity: 0.55 } : undefined}>
          {/* KPI tiles: goal first, then one tile per stage — clicking a
              stage tile points the chart below at that metric. */}
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
              <button key={k} className={"kpi kpi-btn" + (metric === k ? " sel" : "")} onClick={() => setMetric(k)}>
                <div className="kpi-label">{stageLabel(label)}</div>
                <div className="kpi-num">{f[k] || 0}</div>
              </button>
            ))}
          </div>

          {/* Hero trend: daily counts of the selected metric */}
          <div className="card hq-chart">
            <div className="hq-chart-head">
              <span className="eyebrow">Daily {metricLabel.toLowerCase()} · {rel || data?.label || ""}</span>
              <span className="hint" style={{ margin: 0 }}>counted from status changes saved in the app</span>
            </div>
            <TrendChart series={data?.series || []} metric={metric} label={metricLabel} />
          </div>

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
