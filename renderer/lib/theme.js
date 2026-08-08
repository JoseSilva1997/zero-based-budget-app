/* ============================================================
   Theme registry and chart palette. Pure data, no React.

   A theme is one complete palette: background, ink, rules and accent together.
   There is no separate accent axis. Adding a theme is exactly two edits:

     1. a [data-theme="<id>"] block in renderer/app.css (copy the obsidian one,
        which is written to be the template, and honour the THEME CONTRACT
        documented at the top of that file);
     2. an entry below, whose id matches that block's selector.

   Then run `npm run test:tokens`, which walks THEME_IDS and holds every theme
   to the contrast floors the design depends on.

   Nothing else in the app names a theme. Settings renders whatever is in this
   array, main.jsx writes the chosen id to <html data-theme>, and store.jsx
   falls back to DEFAULT_THEME_ID for an unknown persisted value.
   ============================================================ */

/**
 * Ordered as shown in Settings > Appearance. `bg` is the background the
 * preview card is painted with: it exists so the picker can draw a theme the
 * app is not currently wearing, which is why it is plain hex rather than a
 * token. Keep it in step with --board in the CSS block.
 */
export const BUDGET_THEMES = [
  { id: "obsidian", label: "Obsidian", bg: "#000000" },
];

export const THEME_IDS = BUDGET_THEMES.map((t) => t.id);

/** The fallback for a missing or unrecognised persisted theme. */
export const DEFAULT_THEME_ID = BUDGET_THEMES[0].id;

/* Shared by History + Dashboard charts. Categorical, so deliberately NOT
   derived from the theme: these have to stay distinguishable from each other
   rather than agree with the accent. */
export const GROUP_PALETTE = [
  "oklch(0.72 0.14 158)", "oklch(0.75 0.15 45)", "oklch(0.70 0.14 245)",
  "oklch(0.72 0.15 300)", "oklch(0.80 0.14 75)", "oklch(0.70 0.16 20)",
  "oklch(0.76 0.12 195)", "oklch(0.74 0.15 120)",
];
