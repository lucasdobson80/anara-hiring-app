"use client";

// Weekly command centre: the 10-signings-a-week goal front and centre,
// this week's funnel, the all-time pipeline shape, and (in All-team
// scope) who's doing what. Weekly numbers come from Stage Log stamps,
// so they accrue from the day that shipped.

const WEEKLY_GOAL = 10;
// Sourced is deliberately absent — it's 10-20x the other stages and lives
// in Source; the funnel tracks the human pipeline from Approved onward.
const FUNNEL = [
  ["approved", "Approved"],
  ["contacted", "Contacted"],
  ["replied", "Replied"],
  ["interview", "Interview"],
  ["signed", "Signed"],
];
const ALL_TIME_STAGES = ["New", "Approved", "Contacted", "Replied", "Interview", "Signed", "Rejected"];

const daysLeftInWeek = () => 7 - ((new Date().getDay() + 6) % 7); // Mon=7 … Sun=1

export default function HqTab({ counts, weekly, scope, team, user }) {
  const tw = weekly?.thisWeek || {};
  const signed = tw.signed || 0;
  const pct = Math.min(100, Math.round((signed / WEEKLY_GOAL) * 100));
  const maxBar = Math.max(1, ...FUNNEL.map(([k]) => tw[k] || 0));
  const allTimeMax = Math.max(1, ...ALL_TIME_STAGES.map((s) => counts?.[s] || 0));

  return (
    <div>
      <div className="hq-grid">
        <div className="card hq-goal">
          <div className="eyebrow">THIS WEEK&apos;S GOAL{scope === "all" ? " · ALL TEAM" : ""}</div>
          <div className="hq-goal-num">
            <b className="mono">{signed}</b>
            <span className="soft">/ {WEEKLY_GOAL} signed</span>
          </div>
          <div className="hq-goal-track"><div className="hq-goal-fill" style={{ width: `${pct}%` }} /></div>
          <p className="soft" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
            {signed >= WEEKLY_GOAL
              ? "Goal hit — anything more is gravy. 🎉"
              : `${WEEKLY_GOAL - signed} to go · ${daysLeftInWeek()} day${daysLeftInWeek() === 1 ? "" : "s"} left this week (Mon–Sun)`}
          </p>
        </div>

        <div className="card hq-panel">
          <div className="eyebrow">THIS WEEK&apos;S FUNNEL</div>
          <div className="hq-funnel">
            {FUNNEL.map(([k, label]) => (
              <div key={k} className="hq-frow">
                <span className="hq-flabel">{label}</span>
                <div className="hq-fbars">
                  <div className="hq-fbar now" style={{ width: `${((tw[k] || 0) / maxBar) * 100}%` }} />
                </div>
                <span className="mono hq-fnums"><b>{tw[k] || 0}</b></span>
              </div>
            ))}
          </div>
          <p className="soft" style={{ fontSize: 11.5, margin: "10px 0 0" }}>
            counted from status changes saved in the app
          </p>
        </div>

        <div className="card hq-panel">
          <div className="eyebrow">ALL-TIME PIPELINE</div>
          <div className="hq-funnel">
            {ALL_TIME_STAGES.map((s) => (
              <div key={s} className="hq-frow">
                <span className="hq-flabel">{s}</span>
                <div className="hq-fbars">
                  <div className="hq-fbar all" style={{ width: `${((counts?.[s] || 0) / allTimeMax) * 100}%` }} />
                </div>
                <span className="mono hq-fnums"><b>{counts?.[s] || 0}</b></span>
              </div>
            ))}
          </div>
        </div>

        {scope === "all" && weekly?.perOwner && (
          <div className="card hq-panel">
            <div className="eyebrow">TEAM THIS WEEK</div>
            <div className="hq-team">
              <div className="hq-trow hq-thead">
                <span></span><span className="mono">contacted</span><span className="mono">interview</span><span className="mono">signed</span>
              </div>
              {team.map((m) => (
                <div key={m} className={"hq-trow" + (m === user ? " me" : "")}>
                  <span style={{ textTransform: "capitalize" }}>{m}</span>
                  <span className="mono">{weekly.perOwner[m]?.contacted ?? 0}</span>
                  <span className="mono">{weekly.perOwner[m]?.interview ?? 0}</span>
                  <span className="mono"><b>{weekly.perOwner[m]?.signed ?? 0}</b></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="hint">
        Weekly numbers count each creator once per stage, stamped when you press Save — history before
        {" "}{weekly?.weekStart ? "the tracker shipped" : "now"} isn&apos;t dated, so counts build from here.
        Switch My pipeline / All team (top right) to change whose week you&apos;re looking at.
      </p>
    </div>
  );
}
