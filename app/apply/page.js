"use client";

import { useState, useEffect } from "react";

// PUBLIC application form — community owners share this link with their
// members (append ?c=community-name for attribution). Submissions land in
// the Review queue as New; no auth, no app shell.

const AUDIENCES = ["College students", "Researchers & postgrads", "Don't mind"];

export default function ApplyPage() {
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [email, setEmail] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [country, setCountry] = useState("");
  const [audience, setAudience] = useState("Don't mind");
  const [community, setCommunity] = useState("");
  const [logo, setLogo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const c = new URLSearchParams(window.location.search).get("c");
      if (c) setCommunity(c);
    } catch {}
    fetch("/api/logo").then((r) => r.json()).then((d) => { if (d.logo) setLogo(d.logo); }).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, link, email, portfolio, country, audience, community, website: "" }),
      });
      const raw = await res.text();
      let data = null;
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) throw new Error(data?.message || `Something went wrong (${res.status}) — please try again.`);
      setDone(true);
    } catch (e2) {
      setError(e2.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="desk apply-page">
      <div className="apply-card card">
        <div className="apply-brand">
          <span className="workspace-mark" aria-hidden>{logo ? <img src={logo} alt="" /> : "A"}</span>
          <span className="apply-brand-name">Anara</span>
        </div>
        {done ? (
          <>
            <h1 className="apply-title">Thank you — application sent! 🎉</h1>
            <p className="soft apply-sub">
              We&apos;ve got your details and we&apos;ll take a look at your profile.
              <b> We will be in touch</b> by email or DM within a few days.
            </p>
          </>
        ) : (
          <>
            <h1 className="apply-title">Create for Anara — paid UGC work</h1>
            <p className="soft apply-sub">
              Anara (anara.com) is an AI workspace used by students and researchers around the world.
              We pay UGC creators <b>per video</b> — consistent, ongoing paid work you can stack
              week after week, with bonuses when videos take off. Tell us where to find your work
              and we&apos;ll be in touch.
            </p>
            {/* Community-shared links (?c=) lead with the money */}
            {community && (
              <p className="apply-pay">💸 Base rate: <b>$1,000–$2,000 per month</b></p>
            )}
            <form onSubmit={submit} className="apply-form">
              <label className="field">
                <span>Your name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
              </label>
              <label className="field">
                <span>TikTok or Instagram profile link</span>
                <input className="input" value={link} onChange={(e) => setLink(e.target.value)} required placeholder="https://www.tiktok.com/@yourhandle" inputMode="url" />
              </label>
              <label className="field">
                <span>Email</span>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </label>
              <label className="field">
                <span>Portfolio link <span className="soft">(optional)</span></span>
                <input className="input" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} placeholder="beacons.ai, stan.store, Google Drive…" inputMode="url" />
              </label>
              <label className="field">
                <span>Country <span className="soft">(optional)</span></span>
                <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={40} autoComplete="country-name" />
              </label>
              <div className="field">
                <span>Who would you prefer to make content for?</span>
                <div className="apply-choices">
                  {AUDIENCES.map((a) => (
                    <button
                      key={a} type="button"
                      className={"chip" + (audience === a ? " on" : "")}
                      onClick={() => setAudience(a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              {/* Honeypot — humans never see it */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: "absolute", left: "-5000px" }} aria-hidden="true" />
              {error && <div className="banner bad" style={{ borderRadius: 9 }}>{error}</div>}
              <button className="primary apply-submit" disabled={busy}>
                {busy ? "Sending…" : "Send application"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
