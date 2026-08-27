/* ============================================================
   The regression guard for the renderer's styling rule.

   THE RULE (also stated in renderer/styles/tokens.css)
   ---------------------------------------------------
   An inline `style` prop is permitted only for a value that cannot be known
   until runtime. Everything else belongs in renderer/styles/*.css.

   The consolidation project that produced this script took the renderer from
   393 inline style objects to 23. All 23 survivors hold a runtime value: a
   percentage from barGeometry, a member's colour, a measured portal
   coordinate, a size prop. Without a guard the count climbs straight back,
   one "just this once" at a time, and nothing in the test suite or the
   screenshot sweep would notice.

   TWO CHECKS, DELIBERATELY DIFFERENT IN SEVERITY
   ----------------------------------------------
   GUARD 1 - static inline values.  FAILS the build.
     Any inline style property whose value is a literal (a number, a quoted
     string, an uninterpolated template) is a value that could have been a
     class, so it is a violation. Runtime expressions - identifiers, member
     accesses, calls, ternaries, arithmetic, interpolated templates - are the
     whole point of the carve-out and pass silently. Unambiguous, so it is a
     hard failure. The allowlist below is for the genuine exceptions and
     currently holds exactly one.

   GUARD 2 - dormant classes.  WARNS ONLY, never fails.
     When an element carries both a className and an inline style, and a CSS
     rule for that class declares a property the inline style also sets, the
     inline value wins and the CSS declaration has never once applied. The
     class is dormant: it looks live in both the JSX and the stylesheet, and
     it is doing nothing.

     This is not hypothetical. Six were found by hand during the migration:
     .budget-row's grid on History's six-column row, .income-row carried by
     two files with two different inline grids, .btn-ghost on main.jsx's "Add
     group" (the inline colour masked both the class and its :hover, so that
     button had never brightened under the cursor), .section-head, .tinput
     and .update-banner-line. Every one was invisible to the test suite and
     invisible to the screenshots, because the screenshots recorded the
     masked appearance as the correct one.

     Why it only warns: masking is *legitimate* whenever the inline value is
     runtime-derived. .wallet-dot declares a default background and Accounts
     overrides it with the account's own colour - that is the carve-out
     working as designed, not a bug. A check that cannot tell those apart
     must not be able to block a build, or the first person to hit it will
     delete it. So it reports, marks each finding STATIC or runtime, and
     leaves the judgement to a human. An accurate warning beats a hard
     failure that gets suppressed.

   No dependencies, by design: this runs in `pretest`, before anything is
   installed or built, and it must never be the reason a build cannot start.
   Plain node, plain string scanning. It does not parse JavaScript properly
   and does not try to; see LIMITATIONS at the foot of this file.

   Run with:  node scripts/check-inline-styles.mjs
              node scripts/check-inline-styles.mjs --guard=1
              node scripts/check-inline-styles.mjs --guard=2
   ============================================================ */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsxDir = join(root, "renderer");
const cssDir = join(root, "renderer", "styles");

/* ------------------------------------------------------------------
   GUARD 1 ALLOWLIST

   Keyed on file plus a distinctive substring of the offending object, never
   on a line number: line numbers rot on the first edit above them and an
   allowlist that rots silently stops guarding. Adding an entry here is a
   deliberate act that shows up in review; that is the point.

   Every entry needs a `why` that says what makes the literal impossible to
   express as a class. "It was easier" is not one.
   ------------------------------------------------------------------ */
const ALLOWLIST = [
  {
    file: "DashboardCharts.jsx",
    contains: "fontSize: 11",
    why:
      "Must stay numerically equal to axisProps.tick.fontSize, which recharts " +
      "emits as an SVG presentation attribute rather than CSS, so a var() " +
      "would not resolve on that side. One number, one home.",
  },
];

/* ==================================================================
   Shared scanning helpers

   All of these walk source text tracking quote/template/comment state, so a
   brace inside a string or a `${}` inside a template never fools the depth
   count. That is the only real subtlety in the file.
   ================================================================== */

/* Advance past a quoted string starting at `i` (which points at the quote).
   Returns the index just past the closing quote. */
function skipString(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === q) return i + 1;
    i++;
  }
  return i;
}

/* Advance past a template literal starting at the backtick at `i`, following
   nested `${ ... }` (which may themselves contain templates). */
function skipTemplate(src, i) {
  i++;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === "`") return i + 1;
    if (src[i] === "$" && src[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === "'" || c === '"') { i = skipString(src, i); continue; }
        if (c === "`") { i = skipTemplate(src, i); continue; }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

/* Advance past a // or /* comment starting at `i`. Returns i unchanged if
   there is no comment there. */
function skipComment(src, i) {
  if (src[i] !== "/") return i;
  if (src[i + 1] === "/") {
    const nl = src.indexOf("\n", i);
    return nl === -1 ? src.length : nl;
  }
  if (src[i + 1] === "*") {
    const end = src.indexOf("*/", i + 2);
    return end === -1 ? src.length : end + 2;
  }
  return i;
}

/* Read the balanced contents of a brace group whose opening `{` is at `open`.
   Returns { body, end } where `end` is the index of the matching `}`. */
function readBraceGroup(src, open) {
  let i = open + 1;
  let depth = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') { i = skipString(src, i); continue; }
    if (c === "`") { i = skipTemplate(src, i); continue; }
    if (c === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) { i = skipComment(src, i); continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return { body: src.slice(open + 1, i), end: i }; }
    i++;
  }
  return { body: src.slice(open + 1), end: src.length };
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/* Split an object-literal body on its top-level commas. */
function splitTopLevel(body) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "'" || c === '"') { i = skipString(body, i); continue; }
    if (c === "`") { i = skipTemplate(body, i); continue; }
    if (c === "/" && (body[i + 1] === "/" || body[i + 1] === "*")) { i = skipComment(body, i); continue; }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
    i++;
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/* Find every object literal inside an expression, outermost first. Handles
   `{ a: 1 }`, `cond ? { a: 1 } : undefined`, and plain identifiers (which
   yield nothing, correctly - the object is elsewhere). */
function objectLiteralsIn(src, from, to) {
  const found = [];
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === "'" || c === '"') { i = skipString(src, i); continue; }
    if (c === "`") { i = skipTemplate(src, i); continue; }
    if (c === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) { i = skipComment(src, i); continue; }
    if (c === "{") {
      const { body, end } = readBraceGroup(src, i);
      found.push({ body, start: i, end });
      i = end + 1;
      continue;
    }
    i++;
  }
  return found;
}

/* Parse an object-literal body into { key, value, raw } records. A spread is
   skipped (it carries no literal of its own); a shorthand `{ width }` yields
   the identifier as its value, which is dynamic, which is correct. */
function parseProps(body) {
  return splitTopLevel(body).map((raw) => {
    if (raw.startsWith("...")) return null;
    let keyEnd = -1;
    let depth = 0;
    let i = 0;
    while (i < raw.length) {
      const c = raw[i];
      if (c === "'" || c === '"') { i = skipString(raw, i); continue; }
      if (c === "`") { i = skipTemplate(raw, i); continue; }
      if (c === "{" || c === "(" || c === "[") depth++;
      else if (c === "}" || c === ")" || c === "]") depth--;
      else if (c === ":" && depth === 0) { keyEnd = i; break; }
      i++;
    }
    if (keyEnd === -1) return { key: raw.trim(), value: raw.trim(), raw, shorthand: true };
    const key = raw.slice(0, keyEnd).trim().replace(/^['"]|['"]$/g, "");
    return { key, value: raw.slice(keyEnd + 1).trim(), raw, shorthand: false };
  }).filter(Boolean);
}

/* Is this value text a literal the JSX could have handed to a class?
   Numbers, quoted strings and uninterpolated templates are. Anything that
   has to be evaluated is not, and that is the whole carve-out. */
function staticLiteralKind(value) {
  const v = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  if ((v[0] === '"' || v[0] === "'") && skipString(v, 0) === v.length) return "string";
  if (v[0] === "`" && skipTemplate(v, 0) === v.length && !v.includes("${")) return "template";
  return null;
}

const camelToKebab = (k) =>
  k.startsWith("--") ? k : k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/* ==================================================================
   GUARD 1: no static inline values
   ================================================================== */

/* Collect every inline style object in a file: the `style={...}` attributes,
   plus object literals assigned to a variable whose name contains "style"
   (the obvious way round the first check - `const s = {...}; style={s}` -
   and how DebugMenu's menuStyle is already written). */
function collectStyleObjects(src, file) {
  const objects = [];
  const seen = new Set();

  const push = (obj, origin) => {
    if (seen.has(obj.start)) return;
    seen.add(obj.start);
    objects.push({ ...obj, origin, line: lineOf(src, obj.start), file });
  };

  for (const m of src.matchAll(/\bstyle\s*=\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const { end } = readBraceGroup(src, open);
    for (const obj of objectLiteralsIn(src, open + 1, end)) push(obj, "style prop");
  }

  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\w*[Ss]tyle\w*)\s*=\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const { body, end } = readBraceGroup(src, open);
    push({ body, start: open, end }, `variable ${m[1]}`);
  }

  return objects;
}

/* Which half of the rule a literal breaks, for the message. Purely cosmetic:
   every static literal is a violation whatever bucket it lands in. */
const CATEGORY = [
  [/^(font|fontSize|fontWeight|fontFamily|fontStyle|lineHeight|letterSpacing|textTransform)$/, "font"],
  [/color$|^(background|backgroundColor|fill|stroke|boxShadow|outlineColor)$/i, "colour"],
  [/[Rr]adius$/, "radius"],
  [/^(padding|margin|gap|rowGap|columnGap|inset)/, "spacing"],
  [/^(top|left|right|bottom|width|height|minWidth|minHeight|maxWidth|maxHeight)$/, "geometry"],
];
const categoryOf = (key) => (CATEGORY.find(([re]) => re.test(key)) || [null, "value"])[1];

function guard1(files) {
  const violations = [];
  const excused = [];

  for (const [file, src] of files) {
    for (const obj of collectStyleObjects(src, file)) {
      for (const prop of parseProps(obj.body)) {
        /* A computed key - `[openLeft ? 'right' : 'left']: 0` - is itself the
           runtime value. Which property gets set is not knowable until the
           FAB has been dragged, and no class can express "whichever of these
           two", so the literal it is set to is not the thing being judged. */
        if (prop.key.startsWith("[")) continue;
        const kind = staticLiteralKind(prop.value);
        if (!kind) continue;
        /* A CSS custom property set inline is how a component hands CSS a
           number to compute with; a *static* one is still a value that could
           have lived in the stylesheet, so it is not excused here. */
        const hit = {
          file, line: obj.line, origin: obj.origin,
          key: prop.key, value: prop.value.trim(), kind,
          category: categoryOf(prop.key),
          snippet: `{ ${obj.body.trim().replace(/\s+/g, " ").slice(0, 90)} }`,
        };
        const pardon = ALLOWLIST.find(
          (a) => a.file === basename(file) && obj.body.replace(/\s+/g, " ").includes(a.contains)
        );
        if (pardon) excused.push({ ...hit, why: pardon.why });
        else violations.push(hit);
      }
    }
  }
  return { violations, excused };
}

/* ==================================================================
   GUARD 2: dormant classes
   ================================================================== */

/* Longhands a shorthand can mask, and vice versa. Not exhaustive - it covers
   the shorthands the renderer actually uses. A property not listed matches
   only itself, which under-reports rather than over-reports, the right way
   round for a check that asks a human to look. */
const SHORTHANDS = {
  background: ["background-color", "background-image", "background-size", "background-position", "background-repeat", "background-clip", "background-origin", "background-attachment"],
  font: ["font-family", "font-size", "font-weight", "font-style", "line-height", "font-variant", "font-stretch"],
  border: ["border-width", "border-style", "border-color", "border-top", "border-right", "border-bottom", "border-left"],
  "border-radius": ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  inset: ["top", "right", "bottom", "left"],
  gap: ["row-gap", "column-gap"],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  overflow: ["overflow-x", "overflow-y"],
  transition: ["transition-property", "transition-duration", "transition-timing-function", "transition-delay"],
  "grid-template": ["grid-template-columns", "grid-template-rows", "grid-template-areas"],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
};

function propsConflict(a, b) {
  if (a === b) return true;
  if ((SHORTHANDS[a] || []).includes(b)) return true;
  if ((SHORTHANDS[b] || []).includes(a)) return true;
  return false;
}

/* Index every CSS rule by the classes in its SUBJECT compound - the
   right-most one - not by every class anywhere in the selector. `.a .b {}`
   is indexed under b, because it is .b that gets the declarations and .b
   that an inline style on that element would mask.

   Two precision rules, both of which removed real false positives on the
   tree this was written against:

     - A subject compound naming several classes (`.copy-opt.is-on`) is only
       a candidate when the element carries ALL of them. Without this, every
       element with a bare `is-on` matched every `.something.is-on` rule in
       the codebase - six findings from Settings alone, none of them real.
     - A subject with a pseudo-ELEMENT (`.bar-mark-tick::before`) is dropped
       entirely: an inline style applies to the element, never to its
       generated boxes, so it cannot mask those declarations. Pseudo-CLASSES
       (`:hover`) are kept, and must be - the .btn-ghost:hover that had never
       fired is exactly the case this check exists for. */
function indexCss() {
  const byClass = new Map();
  for (const name of readdirSync(cssDir).filter((n) => n.endsWith(".css")).sort()) {
    const raw = readFileSync(join(cssDir, name), "utf8");
    /* Blank comments rather than delete them, so offsets stay usable for
       line numbers. */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      if (!selector || selector.startsWith("@")) continue;
      const line = lineOf(src, m.index);

      const declared = [];
      for (const d of m[2].split(";")) {
        const c = d.indexOf(":");
        if (c === -1) continue;
        /* !important beats an inline style, so such a rule is not dormant. */
        if (/!\s*important/i.test(d)) continue;
        const prop = d.slice(0, c).trim().toLowerCase();
        if (/^[-a-z]+$/.test(prop)) declared.push(prop);
      }
      if (!declared.length) continue;

      for (const part of selector.split(",")) {
        const compounds = part.trim().split(/[\s>+~]+/).filter(Boolean);
        const subject = compounds[compounds.length - 1] || "";
        if (subject.includes("::")) continue;
        const requires = [...subject.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((c) => c[1]);
        if (!requires.length) continue;
        const rule = { file: name, line, selector: part.trim(), declared, requires };
        for (const c of requires) {
          if (!byClass.has(c)) byClass.set(c, []);
          byClass.get(c).push(rule);
        }
      }
    }
  }
  return byClass;
}

/* Walk forward from a JSX `<` to the `>` that closes the opening tag,
   ignoring the `>` in arrow functions and comparisons inside braces. */
function readTag(src, lt) {
  let i = lt + 1;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') { i = skipString(src, i); continue; }
    if (c === "`") { i = skipTemplate(src, i); continue; }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === ">" && depth === 0) return src.slice(lt, i + 1);
    i++;
  }
  return src.slice(lt);
}

/* The `<` that opens the element carrying the attribute at `at`. */
function tagStartFor(src, at) {
  for (let i = at; i >= 0; i--) {
    if (src[i] === "<" && /[A-Za-z]/.test(src[i + 1] || "")) return i;
  }
  return -1;
}

/* Every string literal in a className expression is a candidate class name:
   "a b", cx("a", flag && "b"), `a ${x}` all give up their static parts. */
function classNamesIn(expr) {
  const names = new Set();
  for (const m of expr.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)) {
    for (const n of m[2].split(/\s+/)) {
      if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(n)) names.add(n);
    }
  }
  return [...names];
}

function guard2(files) {
  const byClass = indexCss();
  const findings = [];

  for (const [file, src] of files) {
    for (const m of src.matchAll(/\bstyle\s*=\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const { end } = readBraceGroup(src, open);

      /* Inline properties on this element: from the literal if there is one,
         otherwise from a same-file variable of that name. */
      const objs = objectLiteralsIn(src, open + 1, end);
      let props = objs.flatMap((o) => parseProps(o.body));
      if (!objs.length) {
        const ref = src.slice(open + 1, end).trim();
        if (/^\w+$/.test(ref)) {
          const decl = new RegExp(`\\b(?:const|let|var)\\s+${ref}\\s*=\\s*\\{`).exec(src);
          if (decl) props = parseProps(readBraceGroup(src, decl.index + decl[0].length - 1).body);
        }
      }
      if (!props.length) continue;

      const lt = tagStartFor(src, m.index);
      if (lt === -1) continue;
      const tag = readTag(src, lt);
      const cn = /\bclassName\s*=\s*(\{|["'])/.exec(tag);
      if (!cn) continue;
      const cnExpr = cn[1] === "{"
        ? readBraceGroup(tag, cn.index + cn[0].length - 1).body
        : tag.slice(cn.index + cn[0].length - 1, skipString(tag, cn.index + cn[0].length - 1));

      const classes = classNamesIn(cnExpr);
      const line = lineOf(src, m.index);

      for (const prop of props) {
        const inlineProp = camelToKebab(prop.key.replace(/^\[.*\]$/, ""));
        if (inlineProp.startsWith("[")) continue;
        /* A literal guard 1 has already excused is not news here either, but
           the mask is still shown: someone should still know that the class
           declares a property it never gets to apply. */
        const excused = ALLOWLIST.some(
          (a) => a.file === basename(file) && props.some((p) => `${p.key}: ${p.value}`.replace(/\s+/g, " ").includes(a.contains))
        );
        const isStatic = !excused && !!staticLiteralKind(prop.value);
        const seen = new Set();
        for (const cls of classes) {
          for (const rule of byClass.get(cls) || []) {
            if (!rule.requires.every((r) => classes.includes(r))) continue;
            const key = `${rule.file}:${rule.line}:${inlineProp}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const masked = rule.declared.filter((d) => propsConflict(inlineProp, d));
            if (!masked.length) continue;
            findings.push({
              file, line, cls, inlineProp, masked: [...new Set(masked)],
              value: prop.value.trim().replace(/\s+/g, " ").slice(0, 60),
              isStatic, excused, rule,
            });
          }
        }
      }
    }
  }
  return findings;
}

/* ==================================================================
   Report
   ================================================================== */

const arg = process.argv.find((a) => a.startsWith("--guard="));
const which = arg ? arg.slice(8) : "all";

/* Every .jsx under renderer/, at any depth: the screens sit at the top level
   and the shared vocabulary in renderer/ui/, and a guard that only read one of
   those would go quiet exactly where the components used by every screen live.
   dist/ is build output, so it is skipped rather than scanned twice. */
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

const files = jsxFiles(jsxDir);

let failed = false;

if (which === "all" || which === "1") {
  const { violations, excused } = guard1(files);
  console.log("check-inline-styles / guard 1: static values in inline styles");
  if (violations.length) {
    failed = true;
    console.error(`\n  ${violations.length} inline style ${violations.length === 1 ? "property holds" : "properties hold"} a static value.\n`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.key}: ${v.value}`);
      console.error(`      a static ${v.category} (${v.kind} literal) in a ${v.origin}`);
      console.error(`      ${v.snippet}`);
    }
    console.error(`
  THE RULE: an inline \`style\` prop is permitted only for a value that
  cannot be known until runtime. A literal is knowable now, so it belongs in
  renderer/styles/*.css as a class, using a token if one exists at that exact
  value and its own literal otherwise. See the header of
  renderer/styles/tokens.css.

  If a literal genuinely cannot be a class - the only case so far is a number
  recharts emits as an SVG attribute - add it to ALLOWLIST in
  scripts/check-inline-styles.mjs with a reason. Keyed on file plus a
  distinctive substring, never a line number.
`);
  } else {
    console.log(`  OK - ${files.length} renderer JSX files, no static inline values.`);
  }
  for (const e of excused) {
    console.log(`  allowed  ${e.file}:${e.line}  ${e.key}: ${e.value}`);
    console.log(`           ${e.why.replace(/\s+/g, " ")}`);
  }
  console.log("");
}

if (which === "all" || which === "2") {
  const findings = guard2(files);
  console.log("check-inline-styles / guard 2: classes made dormant by an inline style  [advisory]");
  if (!findings.length) {
    console.log("  OK - no CSS declaration is masked by an inline style.");
  } else {
    const statics = findings.filter((f) => f.isStatic);
    console.log(`\n  ${findings.length} masked ${findings.length === 1 ? "declaration" : "declarations"}${statics.length ? `, ${statics.length} of them from a STATIC inline value` : ""}.\n`);
    for (const f of findings) {
      console.log(`  ${f.isStatic ? "STATIC " : f.excused ? "allowed" : "runtime"}  ${f.file}:${f.line}  .${f.cls}`);
      console.log(`            inline  ${f.inlineProp}: ${f.value}`);
      console.log(`            masks   ${f.rule.file}:${f.rule.line}  ${f.rule.selector} { ${f.masked.join(", ")} }`);
    }
    console.log(`
  A masked declaration has never applied. Two readings, and only a human can
  pick between them:

    runtime  Expected. The class carries the default and the component
             overrides it with a value it could not know earlier. Nothing to
             do, unless the default is now unreachable in every render, in
             which case delete it.

    STATIC   Almost certainly a bug, and also a guard 1 failure. The class
             has real rules that have never once applied; removing the inline
             value switches them on. Six of these were found by hand during
             the consolidation, including a .btn-ghost:hover that had never
             fired. Check what the class does before deleting the override.

    allowed  The literal is on guard 1's allowlist, so the mask is known and
             deliberate. Shown anyway, because the class still declares a
             property it never gets to apply.

  Advisory by design: this check cannot tell a legitimate override from a
  dormant class, so it never fails a build.
`);
  }
}

if (failed) process.exit(1);

/* ============================================================
   LIMITATIONS - read these before trusting a clean run.

   - This scans text, not an AST. An inline style assembled at runtime
     (Object.assign, a spread from a map, a helper that returns a style
     object under a name without "style" in it) is invisible to guard 1.
     Guard 1 catches the shape people actually write; it is a ratchet, not
     a proof.
   - Guard 2 pairs a className with a style prop by reading the opening tag
     they share. A class added by a parent, by a helper, or through a
     variable holding no string literal is not seen.
   - Guard 2 indexes a rule under the classes of its right-most compound
     selector. For `.a .b { ... }` on an element carrying .b it reports the
     mask even when no .a ancestor exists, so a finding can be a false
     positive on the ancestor. The full selector is printed for that reason.
   - Neither guard evaluates CSS specificity beyond skipping !important. It
     does not need to: an inline style outranks every selector, which is
     exactly why masking is invisible until something looks for it.
   ============================================================ */
