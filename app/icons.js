// Tiny inline SVG icon set (Lucide-style, 2px stroke) — consistent across
// devices, unlike emoji glyphs, and inherits currentColor for theming.

const base = {
  width: 14, height: 14, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round",
  "aria-hidden": true, style: { flexShrink: 0, verticalAlign: "-2px" },
};

export const IconX = (p) => (
  <svg {...base} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>
);

export const IconCheck = (p) => (
  <svg {...base} {...p}><path d="M20 6 9 17l-5-5" /></svg>
);

export const IconUndo = (p) => (
  <svg {...base} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
);

export const IconExt = (p) => (
  <svg {...base} strokeWidth={2.25} {...p}><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
);

// ── Sidebar nav set (2px stroke, 15px) ──
const nav = { ...base, width: 15, height: 15, strokeWidth: 2 };

export const IconHome = (p) => (
  <svg {...nav} {...p}><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z" /></svg>
);

export const IconSprout = (p) => (
  <svg {...nav} {...p}><path d="M12 20v-8" /><path d="M12 12c0-4 3-7 8-7 0 4-3 7-8 7Z" /><path d="M12 14c0-3.3-2.5-6-6.5-6 0 3.3 2.5 6 6.5 6Z" /></svg>
);

export const IconUsers = (p) => (
  <svg {...nav} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16.5 4.9a3.5 3.5 0 0 1 0 6.2" /><path d="M18 14.5c1.9.9 3 2.9 3 5.5" /></svg>
);

export const IconSearch = (p) => (
  <svg {...nav} {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.2-4.2" /></svg>
);

export const IconInbox = (p) => (
  <svg {...nav} {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 4h14l3 8v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7Z" /></svg>
);

export const IconMail = (p) => (
  <svg {...nav} {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="m2 7 10 6 10-6" /></svg>
);

export const IconClapper = (p) => (
  <svg {...nav} {...p}><rect x="3" y="9" width="18" height="11" rx="2" /><path d="m3 9 2-5h14l2 5" /><path d="m8.5 4 2 5" /><path d="m14 4 2 5" /></svg>
);

export const IconFlask = (p) => (
  <svg {...nav} {...p}><path d="M10 3v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3" /><path d="M8 3h8" /><path d="M7 15h10" /></svg>
);

export const IconPanel = (p) => (
  <svg {...nav} width={16} height={16} {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9.5 4v16" /></svg>
);

export const IconHandshake = (p) => (
  <svg {...nav} {...p}><path d="m11 17 2 2a1 1 0 1 0 3-3" /><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" /><path d="m21 3 1 11h-2" /><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" /><path d="M3 4h8" /></svg>
);

export const IconGlobe = (p) => (
  <svg {...nav} {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" /></svg>
);

// ── Platform glyphs (monochrome, currentColor) ──
const brand = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true, style: { flexShrink: 0 } };

export const IconTikTok = (p) => (
  <svg {...brand} {...p}><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.3 0 .58.05.88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1Z" /></svg>
);

export const IconInstagram = (p) => (
  <svg {...brand} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" /><circle cx="12" cy="12" r="4.3" /><circle cx="17.4" cy="6.6" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconLinkedIn = (p) => (
  <svg {...brand} {...p}><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.4v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.72C24 .77 23.2 0 22.22 0Z" /></svg>
);
