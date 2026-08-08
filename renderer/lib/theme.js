/* ============================================================
   Theme registry and chart palette. Pure data, no React.
   ============================================================ */

/* Shared by the Tweaks panel + Settings. Dark-only, 4 named backgrounds. */
export const BUDGET_THEMES = [
  { id: "slate",    label: "Slate",    bg: "#0d1016" },
  { id: "obsidian", label: "Obsidian", bg: "#000000" },
  { id: "charcoal", label: "Charcoal", bg: "#131316" },
  { id: "navy",     label: "Navy",     bg: "#0a0f1e" },
];

export const THEME_IDS = BUDGET_THEMES.map((t) => t.id);

/* Accent, independent of theme. Controls buttons, the focus ring, and glows;
   pairs with any of the four backgrounds above. */
export const ACCENT_COLORS = [
  /* The id stays "indigo" (persisted in user settings), but the colour is the
     violet of the design mockups: sRGB of oklch(0.62 0.21 293) in app.css. */
  { id: "indigo",  label: "Violet",  accent: "#8f63f6" },
  { id: "cyan",    label: "Cyan",    accent: "#3fd6ee" },
  { id: "emerald", label: "Emerald", accent: "#3ddc97" },
  { id: "lime",    label: "Lime",    accent: "#c6f24f" },
  { id: "amber",   label: "Amber",   accent: "#facc4a" },
  { id: "rose",    label: "Rose",    accent: "#fb5e7e" },
];

export const ACCENT_IDS = ACCENT_COLORS.map((a) => a.id);

/* Shared by History + Dashboard charts. */
export const GROUP_PALETTE = [
  "oklch(0.72 0.14 158)", "oklch(0.75 0.15 45)", "oklch(0.70 0.14 245)",
  "oklch(0.72 0.15 300)", "oklch(0.80 0.14 75)", "oklch(0.70 0.16 20)",
  "oklch(0.76 0.12 195)", "oklch(0.74 0.15 120)",
];
