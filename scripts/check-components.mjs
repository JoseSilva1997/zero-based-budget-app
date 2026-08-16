/* ============================================================
   check-components: the vocabulary guard.

   THE RULE
   --------
   A class that a component in renderer/ui/ draws may only be written by that
   component. A screen that wants a page header, a section heading, an empty
   state, an alert, a dialog or an object row imports the component; it does
   not type the classes out.

   WHY THIS EXISTS
   ---------------
   The token layer is defended by tests/tokens-electron.cjs and
   check-inline-styles.mjs, and it has held. The component layer had nothing:
   nothing stopped a new screen hand-drawing its own `<div class="topbar">` a
   pixel off, or inventing `.thing-row` beside the six rows that already
   existed. That is how the renderer arrived at four empty states which were
   two, and seven rows which were three - not through anyone deciding, but
   through each screen being written on its own.

   A component is only the app's vocabulary while it is the only way to say
   the word. This is what makes that true after the consolidation instead of
   at the moment of it.

   WHAT IT DOES NOT GUARD
   ----------------------
   The class-level primitives - .panel, .btn, .pill, .minput, .tinput,
   .eyebrow, .truncate, .num - are deliberately absent from OWNED. They have
   no component and are meant to be worn directly: an input that is not a
   MoneyInput still wants the money field's skin, and a card is a card. This
   guard is about drawings that HAVE a single author, not about every class in
   the stylesheet.

   Run with:  node scripts/check-components.mjs
   ============================================================ */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rendererDir = join(root, "renderer");
/* The components themselves, which are of course allowed to draw their own
   classes. Everything under here is the authority rather than a call site. */
const UI_DIR = "renderer/ui";

/* ------------------------------------------------------------------
   OWNED: class -> the component that draws it.

   Adding a component to renderer/ui/ means adding its classes here. That is
   deliberately a manual step: it is the moment to decide whether the new
   drawing really is the only one of its kind, which is the whole question
   this file exists to keep asking.
   ------------------------------------------------------------------ */
const OWNED = {
  topbar: "PageHeader", "topbar-actions": "PageHeader",
  "page-title": "PageHeader", "page-sub": "PageHeader",
  "section-head": "Section",

  empty: "EmptyState", "empty-icon": "EmptyState",
  "empty-title": "EmptyState", "empty-note": "EmptyState",
  alert: "Alert", "alert-banner": "Alert",

  "object-row": "ObjectRow", "object-row-grow": "ObjectRow",
  "object-row-name": "ObjectRow", "object-row-sub": "ObjectRow",
  "object-row-meta": "ObjectRow", "object-row-figs": "ObjectRow",
  "object-row-figure": "ObjectRow", "object-row-figure-sub": "ObjectRow",

  "modal-veil": "Modal", modal: "Modal", "dialog-actions": "ConfirmDialog",

  "chart-card": "ChartCard", "chart-rule": "ChartCard", "chart-head": "ChartCard",
  "chart-title": "ChartCard", "chart-sub": "ChartCard", "chart-body": "ChartCard",

  avatar: "Avatar",
  "pill-diff": "DiffPill", "pill-diff-ontrack": "DiffPill", "pill-diff-breach": "DiffPill",
  "mini-bar": "MiniBar", "mini-bar-fill": "MiniBar",

  "field-wrap": "MoneyInput",
  "field-chip": "FieldChip", "field-chip-tight": "FieldChip",
};

/* ------------------------------------------------------------------
   ALLOWLIST

   Keyed on file plus class, never on a line number, for the same reason
   check-inline-styles.mjs is: a line number rots on the first edit above it
   and an allowlist that rots silently stops guarding.

   Every entry needs a `why` saying what the call site is doing that the
   component cannot. "It was easier" is not one, and neither is "the component
   is awkward here" - that is a reason to fix the component.
   ------------------------------------------------------------------ */
const ALLOWLIST = [
  {
    file: "renderer/main.jsx",
    classes: ["topbar", "topbar-actions"],
    why:
      "Month Budget leads with a month stepper rather than a name, so it is " +
      "the one screen whose top bar is not a title block. PageHeader draws " +
      "the title-block case; .topbar is the bar both sit in, and this screen " +
      "fills it with different parts.",
  },
];

/* ==================================================================
   Scanning

   Every className value in the file, wherever it appears: a bare string, a
   cx() call, a template literal. The value is reduced to the string literals
   inside it and split on whitespace, so `dash-empty` is one token and does
   not collide with `empty`, and `${className}` contributes nothing because
   nothing about it is knowable here.
   ================================================================== */

/* Advance past a quoted string or template literal starting at `i` (which
   points at the opening mark). Returns the index just past the close. */
function skipQuoted(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === q) return i + 1;
    i++;
  }
  return i;
}

/* The balanced {...} expression starting at `i`, quote- and comment-aware so
   a brace inside a string never fools the depth count. */
function readBraced(src, i) {
  const start = i;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipQuoted(src, i); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? src.length : e + 2; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return { text: src.slice(start, i + 1), end: i + 1 }; }
    i++;
  }
  return { text: src.slice(start), end: src.length };
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/* Every class token the file writes by hand, with the line it is on. */
function classTokens(src) {
  const out = [];
  for (const m of src.matchAll(/className\s*=\s*/g)) {
    const at = m.index + m[0].length;
    const line = lineOf(src, m.index);
    const c = src[at];
    let literals = [];
    if (c === '"' || c === "'") {
      literals = [src.slice(at + 1, skipQuoted(src, at) - 1)];
    } else if (c === "{") {
      const { text } = readBraced(src, at);
      /* Only the static halves of the expression can be judged: a bare
         string, and the literal runs of a template between its ${}. */
      for (const s of text.matchAll(/"([^"\\]*)"|'([^'\\]*)'/g)) literals.push(s[1] ?? s[2]);
      for (const t of text.matchAll(/`([^`]*)`/g)) {
        for (const chunk of t[1].split(/\$\{[^}]*\}/)) literals.push(chunk);
      }
    }
    for (const lit of literals) {
      for (const tok of lit.split(/\s+/)) if (tok) out.push({ tok, line });
    }
  }
  return out;
}

function jsxFiles(dir, rel = "renderer") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      if (e.name === "dist") continue;
      out.push(...jsxFiles(join(dir, e.name), `${rel}/${e.name}`));
    } else if (e.name.endsWith(".jsx")) {
      out.push([`${rel}/${e.name}`, readFileSync(join(dir, e.name), "utf8")]);
    }
  }
  return out;
}

/* ==================================================================
   Report
   ================================================================== */

const files = jsxFiles(rendererDir).filter(([name]) => !name.startsWith(UI_DIR));
const violations = [];
const excused = [];

for (const [file, src] of files) {
  for (const { tok, line } of classTokens(src)) {
    const owner = OWNED[tok];
    if (!owner) continue;
    const pardon = ALLOWLIST.find((a) => a.file === file && a.classes.includes(tok));
    if (pardon) excused.push({ file, line, tok, owner, why: pardon.why });
    else violations.push({ file, line, tok, owner });
  }
}

console.log("check-components: component classes written by hand");

if (violations.length) {
  console.error(`\n  ${violations.length} ${violations.length === 1 ? "class is" : "classes are"} drawn outside the component that owns ${violations.length === 1 ? "it" : "them"}.\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  .${v.tok}`);
    console.error(`      drawn by <${v.owner} />, in ${UI_DIR}/`);
  }
  console.error(`
  THE RULE: a class a component in ${UI_DIR}/ draws belongs to that component.
  Import it from './ui/index.js' rather than repeating its markup - that is
  what keeps one heading, one empty state and one row across every screen.

  If this call site genuinely needs something the component cannot express,
  the fix is usually a prop on the component. If it truly cannot be one, add
  an entry to ALLOWLIST in scripts/check-components.mjs with a reason, keyed
  on file plus class.
`);
  process.exit(1);
}

console.log(`  OK - ${files.length} screen JSX files, no component class drawn by hand.`);
for (const e of excused) {
  console.log(`  allowed  ${e.file}:${e.line}  .${e.tok}  (${e.owner})`);
  console.log(`           ${e.why.replace(/\s+/g, " ")}`);
}
