/* ============================================================
   The regression guard for the renderer's bridge rule.

   THE RULE (also stated in renderer/lib/api.js)
   --------------------------------------------
   'window.api' is named in renderer/lib/api.js and nowhere else. Everything
   the renderer wants from the main process comes through that module: budget
   reads and writes via the store, which is its only caller, and the handful of
   things that are not budget data (app version, the menu's shortcut list,
   backups, updates, the dev-only screenshot) via 'api' and 'can' directly.

   Why it needs a guard: reaching for 'window.api' inside a screen always works
   and always looks harmless, so nothing pushes back on it. The renderer had
   eighteen such reaches across four files, and the cost had already landed -
   the backup flow was written twice, in main.jsx and Settings.jsx, with two
   copies of its toast copy to keep in step. A second door into the main
   process is how a store stops being the place the app's writes go through.

   This is the behavioural counterpart to check-components.mjs, which guards
   the visual vocabulary the same way.

   No dependencies, by design: this runs in `pretest`, before anything is
   installed or built, and must never be the reason a build cannot start.

   Run with:  node scripts/check-platform.mjs
   ============================================================ */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rendererDir = join(root, "renderer");

/* The one module the rule exists to concentrate the surface into. */
const HOME = "renderer/lib/api.js";

/* Comments are blanked rather than removed so line numbers survive. A prose
   mention of window.api - reducer.js explains what happens without it - is not
   a call, and a guard that cannot tell those apart is a guard people learn to
   route around. Line comments are only honoured when the '//' is not part of a
   URL, which is the one shape that would otherwise blank real code. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/* Every .js and .jsx under renderer/, at any depth. dist/ is build output. */
function sourceFiles(dir, rel = "renderer") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      if (e.name === "dist") continue;
      out.push(...sourceFiles(join(dir, e.name), `${rel}/${e.name}`));
      continue;
    }
    if (e.name.endsWith(".js") || e.name.endsWith(".jsx")) {
      out.push([`${rel}/${e.name}`, readFileSync(join(dir, e.name), "utf8")]);
    }
  }
  return out;
}

const files = sourceFiles(rendererDir);
const violations = [];

for (const [file, raw] of files) {
  if (file === HOME) continue;
  const src = stripComments(raw);
  for (const m of src.matchAll(/\bwindow\s*\.\s*api\b/g)) {
    const line = lineOf(src, m.index);
    violations.push({ file, line, text: raw.split("\n")[line - 1].trim().slice(0, 100) });
  }
}

console.log("check-platform: the renderer's one door to the main process");

if (!violations.length) {
  console.log(`  OK - ${files.length} renderer source files, window.api named only in ${HOME}.`);
  process.exit(0);
}

console.error(`\n  ${violations.length} ${violations.length === 1 ? "reach" : "reaches"} for window.api outside ${HOME}.\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
console.error(`
  THE RULE: import from renderer/lib/api.js instead.

      import { api, can } from './lib/api.js';

      if (!can("revealDataFolder")) return;
      await api.revealDataFolder();

  'can(name)' replaces the 'window.api && typeof window.api.x === "function"'
  test: the whole surface is absent outside Electron and the two dev-only
  channels are absent from a shipped build, so anything optional is asked for
  by name.

  If the call is a budget read or write, it does not belong here at all - add
  an action to renderer/store.jsx and dispatch it, so the write and its refetch
  stay one thing. See the header of renderer/lib/api.js.
`);
process.exit(1);

/* ============================================================
   LIMITATIONS

   - This scans text, not an AST. A bridge captured under another name
     (`const w = window; w.api.x()`) or reached through a computed member
     (`window["api"]`) is invisible. It catches the shape people actually
     write; it is a ratchet, not a proof.
   - Blanking line comments skips a '//' preceded by ':' so URLs survive
     intact. A real call sitting after a URL on the same line would be missed.
   ============================================================ */
