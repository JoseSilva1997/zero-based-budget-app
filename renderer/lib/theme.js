/* ============================================================
   Theme registry and chart palette. Pure data, no React.
   ============================================================ */

/* Shared by the Tweaks panel + Settings. Dark-only, 12 named palettes. */
export const BUDGET_THEMES = [
  { id: "indigo",  label: "Indigo",  bg: "#0d1016", accent: "#6d6ef6" },
  { id: "violet",  label: "Violet",  bg: "#0d1016", accent: "#b06bf2" },
  { id: "cyan",    label: "Cyan",    bg: "#0d1016", accent: "#3fd6ee" },
  { id: "emerald", label: "Emerald", bg: "#0d1016", accent: "#3ddc97" },
  { id: "mono",    label: "Mono",    bg: "#000000", accent: "#c4c8d4" },
  { id: "lime",    label: "Lime",    bg: "#000000", accent: "#c6f24f" },
  { id: "amber",   label: "Amber",   bg: "#000000", accent: "#facc4a" },
  { id: "rose",    label: "Rose",    bg: "#131316", accent: "#fb5e7e" },
  { id: "sky",     label: "Sky",     bg: "#131316", accent: "#5aa0ff" },
  { id: "ocean",   label: "Ocean",   bg: "#0a0f1e", accent: "#4a8df5" },
  { id: "teal",    label: "Teal",    bg: "#0a0f1e", accent: "#33dcc4" },
  { id: "sunset",  label: "Sunset",  bg: "#15110f", accent: "#fb7a45" },
];

export const THEME_IDS = BUDGET_THEMES.map((t) => t.id);

/* Shared by History + Dashboard charts. */
export const GROUP_PALETTE = [
  "oklch(0.72 0.14 158)", "oklch(0.75 0.15 45)", "oklch(0.70 0.14 245)",
  "oklch(0.72 0.15 300)", "oklch(0.80 0.14 75)", "oklch(0.70 0.16 20)",
  "oklch(0.76 0.12 195)", "oklch(0.74 0.15 120)",
];
