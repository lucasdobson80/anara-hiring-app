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
