---
name: screenshot-app
description: Launch House Budget (this repo's Electron desktop app) in an isolated sandbox and take real screenshots of any screen, to visually verify UI/CSS changes actually rendered correctly. Use this whenever asked to check, verify, show, or confirm how a screen looks after a frontend/UI/CSS change to this app - Settings, Dashboard, Month Budget, History, or any component - especially instead of just re-reading the JSX/CSS source, since that cannot show you the actual rendered result the way a screenshot can. Also use when asked to compare two states (e.g. two themes, before/after a change) or to check that text stays legible or a layout doesn't break.
---

# Screenshotting House Budget

This app is an Electron desktop app - there is no dev server or browser tab
to point a normal browser tool at, which otherwise leaves you evaluating the
JSX/CSS source only and never seeing what actually renders. This skill drives
the real app with Playwright's Electron support and saves real PNG
screenshots you can then open with the Read tool.

## Safety: sandboxed by default

This app's dev launch (`electron .`, which is exactly what `npm start` runs)
reads and writes the **same** SQLite database a real installed copy of the
app uses - there is no separate dev/test data directory built into the app
itself. Left unguarded, a screenshot session could click something that
changes a real user's actual settings or budget data (this happened once
during development: a theme got left changed and had to be manually
reverted).

`screenshot.mjs` defaults to launching with Electron's `--user-data-dir` flag
pointed at `.sandbox-userdata/` inside this skill folder (gitignored) -
a completely separate SQLite database the real app never touches. The first
run seeds it with a small, realistic fixture (two members, two accounts, one
populated month with income/groups/items/actuals, including one item pushed
over budget) so screens don't look like empty placeholders. Later runs reuse
that same sandbox, so state (like a theme change) persists across screenshot
calls in one working session, the way it would in a real app - add `--reseed`
to wipe and start clean.

**Only pass `--real` (together with `--confirm-real-data`, both required) if
explicitly asked to see real data.** Default to the sandbox otherwise - it's
extremely rare that verifying a UI change needs the real database.

## Basic usage

```bash
node .claude/skills/screenshot-app/screenshot.mjs \
  --nav Settings --wait 400 --shot .claude/skills/screenshot-app/out/settings.png
```

Then view it:
- Use the Read tool on the PNG path.

Steps run in the order given, against a single app launch:

| Flag | Effect |
|---|---|
| `--nav <text>` / `--click <text>` | click a sidebar nav item, button, or radio swatch by its visible text or `aria-label` (identical, `--nav` just reads better for navigation) |
| `--shot <path>` | screenshot, saved to `<path>` (relative to cwd) |
| `--wait <ms>` | pause before the next step - give a repaint or a fetch time to settle |
| `--type <text>` | type at the current keyboard focus |
| `--press <key>` | press one key, e.g. `Enter`, `Escape`, `Tab` |
| `--eval <js>` | run a JS expression in the page, print the JSON result - for reading computed styles, text content, or anything a screenshot alone can't confirm |
| `--all-screens <dir>` | visit all 4 tabs (Dashboard, Month Budget, History, Settings) and shoot each to `<dir>/<tab-name>.png` - shorthand for four `--nav`/`--wait`/`--shot` triples |

Flags (not tied to step order):

| Flag | Effect |
|---|---|
| `--no-build` | skip the `npm run build && build:renderer` step. Only safe if you're certain the last build already reflects the current source - the default is to always rebuild first, since a stale bundle is a silent way to screenshot the wrong thing. |
| `--reseed` | wipe the sandbox fixture DB and reseed before launching |
| `--real` + `--confirm-real-data` | launch against the real app data (see Safety above) - both flags required together |
| `--no-fullpage` | screenshot only the visible viewport instead of the full scrollable page (default: full page) |

### How the full-page shot actually works

Playwright's own `page.screenshot({ fullPage: true })` grows the *viewport*
to `document.documentElement`'s scroll size. That's a no-op in this app: the
document never scrolls, `.main` does (`overflow-y: auto` in `app.css`), so
Playwright saw no overflow and quietly returned the same image as a plain
viewport shot - a tall screen like Settings used to come back clipped to
860px with no error or warning.

`--shot` (fullpage, the default) now goes through
[`full-page-capture.mjs`](full-page-capture.mjs) instead: it runs inside the
real Electron main process (via `ElectronApplication#evaluate`), measures how
much of `.main` is hidden by its own scrollbar, grows the *actual OS window*
by exactly that much so the whole page lays out with nothing left to scroll,
takes one native `BrowserWindow#capturePage()`, then puts the window back.
One real paint, no stitching, no document-scroll assumption. `--no-fullpage`
skips all of this and just takes a plain viewport shot.

`captureFullPage(app, page, selector?)` is also importable on its own if you
want a full-page PNG `Buffer` from other tooling - `selector` defaults to
`.main` (this app's scroll container) and rarely needs overriding:

```js
import { _electron as electron } from 'playwright-core';
import { captureFullPage } from './full-page-capture.mjs';
import fs from 'node:fs';

const app = await electron.launch({ /* ... */ });
const page = await app.firstWindow();
const png = await captureFullPage(app, page);
fs.writeFileSync('out.png', png);
await app.close();
```

`--click` matching: exact `aria-label` match, then exact visible-text match,
then substring matches of each, in that order. Prefer the exact visible
label shown on screen (e.g. `Obsidian`, `Settings`) - check the
component source (`renderer/*.jsx`) for the precise `aria-label` if a click
reports `NOT_FOUND`.

## Examples

Screenshot all 4 screens in one launch:
```bash
node .claude/skills/screenshot-app/screenshot.mjs \
  --all-screens .claude/skills/screenshot-app/out
```

Screenshot the Settings > Appearance panel:
```bash
node .claude/skills/screenshot-app/screenshot.mjs \
  --nav Settings --wait 400 \
  --shot .claude/skills/screenshot-app/out/settings.png
```

Switch theme, then check two screens against it. Obsidian is the only theme
the app ships today, so this is mostly a template for when there are more:
```bash
node .claude/skills/screenshot-app/screenshot.mjs \
  --nav Settings --wait 400 \
  --click Obsidian --wait 300 \
  --shot .claude/skills/screenshot-app/out/settings-obsidian.png \
  --nav "Month Budget" --wait 400 \
  --shot .claude/skills/screenshot-app/out/month-obsidian.png
```

Read a computed style instead of (or in addition to) a screenshot - e.g. to
confirm a CSS variable resolved the way you expect:
```bash
node .claude/skills/screenshot-app/screenshot.mjs \
  --nav Settings \
  --eval "getComputedStyle(document.documentElement).getPropertyValue('--accent')"
```

## What screenshots look like

The window opens at a fixed 1280x860 (the app's own default; this skill does
not resize it). The sandbox fixture always seeds the same two members (Alex,
Sam), two accounts (Main, Wallet), and one month with a rent item, a
Groceries item pushed slightly over budget, and an Emergency fund savings
item - so screenshots are directly comparable across runs and across
iterations of a change.

## Gotchas

- **Build first.** Both the main process (`npm run build`, TypeScript) and
  the renderer bundle (`npm run build:renderer`, esbuild) are compiled
  output - editing `renderer/*.jsx` alone does nothing until it's rebuilt.
  The default behaviour already does this; only skip it with `--no-build`
  when you're certain nothing changed since the last build.
- **`--user-data-dir` must come before the app path** in Electron's argv -
  the script already orders this correctly; if you ever call `_electron`
  directly instead of through this script, keep that order.
- **A `NOT_FOUND` click** usually means either the previous step's `--wait`
  was too short for a screen transition to finish, or the visible text
  doesn't match exactly - check the component's JSX for the real label or
  `aria-label`.
- **Closing cleanly matters.** The script always calls `app.close()` in a
  `finally` block so a failed step doesn't leave an orphaned Electron
  process running.
