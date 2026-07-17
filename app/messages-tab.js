"use client";

import { useState, useEffect } from "react";
import { DEFAULT_MESSAGES, DEFAULT_MESSAGE_NAMES } from "@/lib/templates";

// Personal message bank / settings page. Every account starts with the
// three editable defaults (Outreach DM, Follow-up bump, Welcome email) and
// can add their own snippets. {first} is swapped for the creator's first
// name wherever these are used in Review / Onboard.

export default function MessagesTab({ messages, onSaved, user, copy, copiedKey }) {
  const [drafts, setDrafts] = useState(messages || DEFAULT_MESSAGES);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [savedName, setSavedName] = useState(null);
  const [newName, setNewName] = useState("");

  // Re-sync when the page's copy updates (e.g. after our own save)
  useEffect(() => { if (messages) setDrafts(messages); }, [messages]);

  const names = [
    ...DEFAULT_MESSAGE_NAMES.filter((n) => n in drafts),
    ...Object.keys(drafts).filter((n) => !DEFAULT_MESSAGE_NAMES.includes(n)),
  ];

  const saveAll = async (justSaved) => {
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/settings/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: drafts }),
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

  const addSnippet = () => {
    const name = newName.trim().slice(0, 60);
    if (!name || name in drafts) return;
    setDrafts((d) => ({ ...d, [name]: "" }));
    setNewName("");
  };

  const deleteSnippet = (name) => {
    setDrafts((d) => { const n = { ...d }; delete n[name]; return n; });
  };

  return (
    <div className="messages-tab">
      <div className="card" style={{ padding: "18px 22px", marginBottom: 16 }}>
        <div className="eyebrow">MY MESSAGE BANK ({(user || "me").toUpperCase()})</div>
        <p className="soft" style={{ fontSize: 13, margin: "8px 0 0", lineHeight: 1.55 }}>
          Your personal outreach &amp; onboarding copy. Write <span className="mono">{"{first}"}</span> wherever
          the creator&apos;s first name should appear (becomes &quot;there&quot; when unknown). The Outreach DM and
          Welcome email here are what the Review and Onboard buttons send.
        </p>
      </div>

      {err && <div className="banner bad" style={{ borderRadius: 10, marginBottom: 12 }}>{err}</div>}

      {names.map((name) => {
        const isDefault = DEFAULT_MESSAGE_NAMES.includes(name);
        return (
          <div key={name} className="card msg-card">
            <div className="msg-head">
              <div className="msg-name">{name}{isDefault && <span className="msg-tag">default</span>}</div>
              <div className="msg-actions">
                {isDefault && drafts[name] !== DEFAULT_MESSAGES[name] && (
                  <button className="ghost small" onClick={() => setDrafts((d) => ({ ...d, [name]: DEFAULT_MESSAGES[name] }))}>Reset to default</button>
                )}
                {!isDefault && (
                  <button className="ghost small" onClick={() => deleteSnippet(name)}>Delete</button>
                )}
                <button className="ghost small" onClick={() => copy("msg-" + name, drafts[name] || "")}>
                  {copiedKey === "msg-" + name ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>
            <textarea
              className="input msg-area"
              value={drafts[name] || ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button className="primary small" onClick={() => saveAll(name)} disabled={saving}>
                {saving ? "Saving…" : savedName === name ? "Saved ✓" : "Save"}
              </button>
            </div>
          </div>
        );
      })}

      <div className="card msg-card">
        <div className="eyebrow">ADD A SNIPPET</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Snippet name, e.g. LinkedIn opener"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addSnippet(); }}
          />
          <button className="ghost" onClick={addSnippet} disabled={!newName.trim() || newName.trim() in drafts}>Add</button>
        </div>
      </div>
    </div>
  );
}
