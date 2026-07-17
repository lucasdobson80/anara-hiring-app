"use client";

import { useState, useEffect, useRef } from "react";
import { DEFAULT_MESSAGES, DEFAULT_MESSAGE_NAMES, MESSAGE_GROUPS, isLinkMessage, isRichMessage, htmlToText } from "@/lib/templates";

// Rich (HTML) editor — keeps pasted links + bullets. Uncontrolled: sets its
// HTML once on mount, so remount (via key) is how the parent updates it.
function RichField({ html, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = html || ""; }, []);
  return (
    <div
      ref={ref}
      className="input msg-area msg-rich"
      contentEditable
      suppressContentEditableWarning
      onInput={() => onChange(ref.current.innerHTML)}
    />
  );
}

// Personal message bank / settings page — a fixed set of outreach and
// onboarding copy, grouped. {first} is swapped for the creator's first name
// wherever these are used in Review / Onboard. Entries whose name ends in
// "link" are single URLs.

export default function MessagesTab({ messages, onSaved, user, copy, copyRich, copiedKey }) {
  const [drafts, setDrafts] = useState(messages || DEFAULT_MESSAGES);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [savedName, setSavedName] = useState(null);
  const [richKey, setRichKey] = useState(0); // bump to remount the rich editor

  // Re-sync when the page's copy updates (e.g. our fetch resolves / a save)
  useEffect(() => { if (messages) { setDrafts(messages); setRichKey((k) => k + 1); } }, [messages]);

  const save = async (justSaved) => {
    setSaving(true); setErr(null);
    try {
      // Only persist the fixed set — drop any stray legacy custom keys
      const payload = {};
      for (const name of DEFAULT_MESSAGE_NAMES) payload[name] = drafts[name] ?? DEFAULT_MESSAGES[name];
      const res = await fetch("/api/settings/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      onSaved?.(data.messages);
      setSavedName(justSaved || true);
      setTimeout(() => setSavedName(null), 2000);
    } catch (e) {
      setErr(e.message);
    } finally { setSaving(false); }
  };

  const resetOne = (name) => {
    setDrafts((d) => ({ ...d, [name]: DEFAULT_MESSAGES[name] }));
    if (isRichMessage(name)) setRichKey((k) => k + 1);
  };

  const card = (name) => {
    const link = isLinkMessage(name);
    const rich = isRichMessage(name);
    const val = drafts[name] ?? "";
    return (
      <div key={name} className="card msg-card">
        <div className="msg-head">
          <div className="msg-name">{name}</div>
          <div className="msg-actions">
            {val !== DEFAULT_MESSAGES[name] && (
              <button className="ghost small" onClick={() => resetOne(name)}>Reset to default</button>
            )}
            <button
              className="ghost small"
              onClick={() => (rich ? copyRich("msg-" + name, val, htmlToText(val)) : copy("msg-" + name, val))}
            >
              {copiedKey === "msg-" + name ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
        {rich ? (
          <>
            <RichField key={richKey} html={val} onChange={(h) => setDrafts((d) => ({ ...d, [name]: h }))} />
            <p className="soft" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
              Paste your formatted email here — hyperlinks and bullet points are kept. Use <span className="mono">{"{first}"}</span> for the creator&apos;s name.
            </p>
          </>
        ) : link ? (
          <input
            className="input"
            placeholder="https://…"
            value={val}
            onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
          />
        ) : (
          <textarea
            className="input msg-area"
            value={val}
            onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
          />
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button className="primary small" onClick={() => save(name)} disabled={saving}>
            {saving ? "Saving…" : savedName === name ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="messages-tab">
      <div className="card" style={{ padding: "18px 22px", marginBottom: 16 }}>
        <div className="eyebrow">MY MESSAGE BANK ({(user || "me").toUpperCase()})</div>
        <p className="soft" style={{ fontSize: 13, margin: "8px 0 0", lineHeight: 1.55 }}>
          Your personal outreach &amp; onboarding copy. Write <span className="mono">{"{first}"}</span> wherever
          the creator&apos;s first name should appear (becomes &quot;there&quot; when unknown). These are what the
          Review and Onboard buttons send.
        </p>
      </div>

      {err && <div className="banner bad" style={{ borderRadius: 10, marginBottom: 12 }}>{err}</div>}

      {MESSAGE_GROUPS.map((g) => (
        <div key={g.label} style={{ marginBottom: 8 }}>
          <div className="eyebrow" style={{ margin: "6px 2px 10px" }}>{g.label.toUpperCase()}</div>
          {g.names.map(card)}
        </div>
      ))}
    </div>
  );
}
