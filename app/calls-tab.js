"use client";

import { useState, useEffect, useCallback } from "react";
import { INTERVIEW_INTRO, INTERVIEW_CLOSE } from "@/lib/templates";

const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

// Match a calendar event to a pipeline creator by name or handle appearing
// in the event title/description.
function matchPerson(event, people) {
  const hay = `${event.title} ${event.description}`.toLowerCase();
  return people.find((p) => {
    const name = (p.name || "").toLowerCase();
    const handle = (p.handle || "").toLowerCase().replace(/^@/, "");
    return (name.length > 3 && hay.includes(name)) || (handle.length > 3 && hay.includes(handle));
  });
}

export default function CallsTab({ people, copy, copiedKey }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [openNotes, setOpenNotes] = useState({}); // eventId -> bool
  const [drafts, setDrafts] = useState({}); // eventId -> text
  const [noteTargets, setNoteTargets] = useState({}); // eventId -> pageId
  const [savingNote, setSavingNote] = useState(null);
  const [savedFlash, setSavedFlash] = useState(null);
  const [schedPerson, setSchedPerson] = useState("");
  const [schedDay, setSchedDay] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [schedDuration, setSchedDuration] = useState(30);
  const [scheduling, setScheduling] = useState(false);
  const [schedMsg, setSchedMsg] = useState(null);
  const [lastBooked, setLastBooked] = useState(null);

  // Next 14 days as friendly options, and 15-minute slots 08:00-21:00
  const dayOptions = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow"
      : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    return { iso, label };
  });
  const timeOptions = [];
  for (let h = 8; h <= 21; h++) for (const m of [0, 15, 30, 45]) {
    if (h === 21 && m > 0) continue;
    timeOptions.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/calls");
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "setup") { setNeedsSetup(true); setEvents([]); return; }
        throw new Error(data.message || `Request failed (${res.status})`);
      }
      setNeedsSetup(false);
      setEvents(data.events);
    } catch (e) {
      setError("Couldn't load the calendar: " + e.message);
      setEvents([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveNote = async (eventId, matchedId) => {
    const note = (drafts[eventId] || "").trim();
    const pageId = noteTargets[eventId] || matchedId;
    if (!note || !pageId) return;
    setSavingNote(eventId);
    try {
      const res = await fetch("/api/notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      setDrafts((d) => ({ ...d, [eventId]: "" }));
      setSavedFlash(eventId);
      setTimeout(() => setSavedFlash(null), 2500);
    } catch (e) {
      alert("Couldn't save the note: " + e.message);
    } finally { setSavingNote(null); }
  };

  const schedule = async () => {
    const person = people.find((p) => p.id === schedPerson);
    if (!person || !schedDay || !schedTime) return;
    setScheduling(true); setSchedMsg(null); setLastBooked(null);
    try {
      const res = await fetch("/api/calls", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Anara interview — ${person.name || person.handle}`,
          startISO: new Date(`${schedDay}T${schedTime}`).toISOString(),
          durationMins: schedDuration,
          description: `Creator: ${person.handle || person.name}\nProfile: ${person.link || ""}\nStage: ${person.status}\n\nScheduled from the Casting Desk.`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      setLastBooked(data);
      setSchedDay(""); setSchedTime("");
      await load();
    } catch (e) {
      setSchedMsg("Couldn't book it: " + e.message);
    } finally { setScheduling(false); }
  };

  if (events === null) return <div className="empty">Loading your calendar…</div>;

  if (needsSetup) return (
    <div className="empty card">
      <div className="empty-title">Connect Google Calendar</div>
      <div className="soft" style={{ maxWidth: 520, margin: "10px auto 0", lineHeight: 1.6 }}>
        One-time setup: create a Google Cloud OAuth client, run the helper script
        (<span className="mono">node scripts/google-auth.mjs</span>) to authorize your Google account,
        and add <span className="mono">GOOGLE_CLIENT_ID</span>, <span className="mono">GOOGLE_CLIENT_SECRET</span>,
        and <span className="mono">GOOGLE_REFRESH_TOKEN</span> to the environment. Full walkthrough in the chat.
      </div>
    </div>
  );

  const interviewees = [...people].sort((a, b) => {
    const rank = (p) => (p.status === "Replied" ? 0 : p.status === "Interview" ? 1 : 2);
    return rank(a) - rank(b);
  });

  const byDay = [];
  for (const ev of events) {
    const day = fmtDay(ev.start);
    const last = byDay[byDay.length - 1];
    if (last && last.day === day) last.events.push(ev);
    else byDay.push({ day, events: [ev] });
  }

  return (
    <div>
      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card" style={{ padding: "18px 22px", marginBottom: 18 }}>
        <div className="eyebrow">SCHEDULE AN INTERVIEW</div>
        <div className="sched-row">
          <select className="input" value={schedPerson} onChange={(e) => setSchedPerson(e.target.value)}>
            <option value="">Pick a creator…</option>
            {interviewees.map((p) => (
              <option key={p.id} value={p.id}>{(p.name || p.handle) + " · " + p.status}</option>
            ))}
          </select>
          <select className="input" value={schedDay} onChange={(e) => setSchedDay(e.target.value)}>
            <option value="">Day…</option>
            {dayOptions.map((d) => <option key={d.iso} value={d.iso}>{d.label}</option>)}
          </select>
          <select className="input" value={schedTime} onChange={(e) => setSchedTime(e.target.value)}>
            <option value="">Time…</option>
            {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="input" value={schedDuration} onChange={(e) => setSchedDuration(Number(e.target.value))}>
            {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
          <button className="primary" onClick={schedule} disabled={scheduling || !schedPerson || !schedDay || !schedTime}>
            {scheduling ? "Booking…" : "Book + Meet"}
          </button>
        </div>
        {schedMsg && <p className="soft" style={{ fontSize: 13, margin: "8px 0 0" }}>{schedMsg}</p>}
        {lastBooked && (
          <div className="booked-box">
            <div>
              <div className="eyebrow" style={{ color: "#3ECF8E" }}>BOOKED — {fmtDay(lastBooked.start)} {fmtTime(lastBooked.start)}</div>
              <div className="mono soft" style={{ fontSize: 12.5, marginTop: 4 }}>{lastBooked.meetLink || "Meet link pending"}</div>
            </div>
            {lastBooked.meetLink && (
              <button className="ghost" onClick={() => copy("booked-meet", lastBooked.meetLink)}>
                {copiedKey === "booked-meet" ? "Copied ✓" : "Copy Meet link"}
              </button>
            )}
            <a className="ghost" style={{ textDecoration: "none" }} href={lastBooked.calendarLink} target="_blank" rel="noreferrer">Open in Calendar ↗</a>
          </div>
        )}
        <div className="sched-scripts">
          <button className="chip" onClick={() => copy("call-intro", INTERVIEW_INTRO)}>
            {copiedKey === "call-intro" ? "Copied ✓" : "Copy intro script"}
          </button>
          <button className="chip" onClick={() => copy("call-close", INTERVIEW_CLOSE)}>
            {copiedKey === "call-close" ? "Copied ✓" : "Copy closing script"}
          </button>
        </div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 8 }}>NEXT TWO WEEKS</div>
      {events.length === 0 && (
        <div className="empty card">
          <div className="empty-title">No calls on the calendar</div>
          <div className="soft">Book one above, or send booking links to creators in Replied.</div>
        </div>
      )}

      {byDay.map(({ day, events: dayEvents }) => (
        <div key={day} style={{ marginBottom: 14 }}>
          <div className={"day-label" + (day === "Today" ? " hot" : "")}>{day}</div>
          {dayEvents.map((ev) => {
            const matched = matchPerson(ev, people);
            const open = openNotes[ev.id];
            return (
              <div key={ev.id} className="call-row-wrap">
                <div className="call-row">
                  <span className="mono soft call-time">{ev.allDay ? "all day" : fmtTime(ev.start)}</span>
                  <span className="call-title">{ev.title}</span>
                  {matched && <span className="badge">{matched.name || matched.handle} · {matched.status}</span>}
                  {ev.meetLink && <a className="watch small-join" href={ev.meetLink} target="_blank" rel="noreferrer">Join Meet</a>}
                  {ev.meetLink && (
                    <button className="ghost small" onClick={() => copy(`meet-${ev.id}`, ev.meetLink)}>
                      {copiedKey === `meet-${ev.id}` ? "Copied ✓" : "Copy link"}
                    </button>
                  )}
                  <a className="ghost small" href={ev.calendarLink} target="_blank" rel="noreferrer">↗</a>
                  <button className="ghost small" onClick={() => setOpenNotes((o) => ({ ...o, [ev.id]: !o[ev.id] }))}>
                    {open ? "Close" : "Notes"}
                  </button>
                </div>
                {open && (
                  <div className="note-box">
                    <div className="sched-row">
                      <select
                        className="input"
                        value={noteTargets[ev.id] || matched?.id || ""}
                        onChange={(e) => setNoteTargets((t) => ({ ...t, [ev.id]: e.target.value }))}
                      >
                        <option value="">Save note to…</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>{p.name || p.handle}</option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      className="input note-area"
                      placeholder="Interview notes — saved to this creator's Notes in Notion, timestamped."
                      value={drafts[ev.id] || ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [ev.id]: e.target.value }))}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      {savedFlash === ev.id && <span className="soft" style={{ fontSize: 13, alignSelf: "center" }}>Saved to Notion ✓</span>}
                      <button
                        className="primary"
                        onClick={() => saveNote(ev.id, matched?.id)}
                        disabled={savingNote === ev.id || !(drafts[ev.id] || "").trim() || !(noteTargets[ev.id] || matched?.id)}
                      >
                        {savingNote === ev.id ? "Saving…" : "Save note"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <p className="hint">
        Calls match to creators automatically when the event mentions their name or handle — booking through
        &quot;Book + Meet&quot; always matches. Notes land on the creator&apos;s Notion page under Notes.
      </p>
    </div>
  );
}
