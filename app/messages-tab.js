"use client";

import { useState, useEffect, useRef } from "react";
import { DEFAULT_MESSAGES, DEFAULT_MESSAGE_NAMES, MESSAGE_GROUPS, isLinkMessage, isRichMessage, htmlToText, cleanEmailHtml } from "@/lib/templates";

// Rich (HTML) editor — keeps pasted links + bullets but strips theme colours
// so copies paste with the recipient's default styling (no dark backgrounds).
// Uncontrolled: sets its HTML once on mount, remount (via key) updates it.
function RichField({ html, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = html || ""; }, []);
  const onPaste = (e) => {
    e.preventDefault();
    const src = e.clipboardData.getData("text/html") || e.clipboardData.getData("text/plain");
    document.execCommand("insertHTML", false, cleanEmailHtml(src));
    onChange(ref.current.innerHTML);
  };
  const onCopy = (e) => {
    e.preventDefault();
    const clean = cleanEmailHtml(ref.current.innerHTML);
    e.clipboardData.setData("text/html", clean);
    e.clipboardData.setData("text/plain", htmlToText(clean));
  };
  return (
    <div
      ref={ref}
      className="input msg-area msg-rich"
      contentEditable
      suppressContentEditableWarning
      onInput={() => onChange(ref.current.innerHTML)}
      onPaste={onPaste}
      onCopy={onCopy}
    />
  );
}

// Personal message bank / settings page — a fixed set of outreach and
// onboarding copy, grouped. {first} is swapped for the creator's first name
// wherever these are used in Review / Onboard. Entries whose name ends in
// "link" are single URLs.

export default function MessagesTab({ messages, degraded = false, onSaved, user, copy, copyRich, copiedKey }) {
  const [drafts, setDrafts] = useState(messages || DEFAULT_MESSAGES);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [savedName, setSavedName] = useState(null);
  const [richKey, setRichKey] = useState(0); // bump to remount the rich editor

  // Re-sync when the page's copy updates (e.g. our fetch resolves / a save)
  useEffect(() => { if (messages) { setDrafts(messages); setRichKey((k) => k + 1); } }, [messages]);

  const save = async (justSaved) => {
    // Never save while the bank was loaded from defaults (store unreachable)
    // — it would overwrite the real stored bank with defaults.
    if (degraded) { setErr("Storage is unreachable right now — saving is paused so your saved messages can't be overwritten. Reload once Apify is back."); return; }
    setSaving(true); setErr(null);
    try {
      // Only persist the fixed set — drop stray legacy keys, clean rich HTML
      const payload = {};
      for (const name of DEFAULT_MESSAGE_NAMES) {
        const v = drafts[name] ?? DEFAULT_MESSAGES[name];
        payload[name] = isRichMessage(name) ? cleanEmailHtml(v) : v;
      }
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
              onClick={() => (rich ? copyRich("msg-" + name, cleanEmailHtml(val), htmlToText(cleanEmailHtml(val))) : copy("msg-" + name, val))}
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
          <button className="primary small" onClick={() => save(name)} disabled={saving || degraded}>
            {saving ? "Saving…" : savedName === name ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="messages-tab">
      <div className="card" style={{ padding: "18px 22px", marginBottom: 16 }}>
        <div className="eyebrow">My message bank ({user || "me"})</div>
        {degraded && (
          <div className="banner bad" style={{ borderRadius: 9, margin: "10px 0 0" }}>
            Showing DEFAULT messages — storage is unreachable (check Apify billing). Your saved
            messages are safe; saving is paused so they can&apos;t be overwritten. Reload once it&apos;s back.
          </div>
        )}
        <p className="soft" style={{ fontSize: 13, margin: "8px 0 0", lineHeight: 1.55 }}>
          Your personal outreach &amp; onboarding copy. Write <span className="mono">{"{first}"}</span> wherever
          the creator&apos;s first name should appear (becomes &quot;there&quot; when unknown). These are what the
          Review and Onboard buttons send.
        </p>
      </div>

      {err && <div className="banner bad" style={{ borderRadius: 10, marginBottom: 12 }}>{err}</div>}

      {MESSAGE_GROUPS.map((g) => (
        <div key={g.label} style={{ marginBottom: 8 }}>
          <div className="eyebrow" style={{ margin: "6px 2px 10px" }}>{g.label}</div>
          {g.names.map(card)}
        </div>
      ))}
    </div>
  );
}
