/* ============================================================
   Contrast floors, for every theme the app ships.

   Loads renderer/app.css into a real hidden window, wears each data-theme in
   turn, and asserts the contrast ratios the design depends on. This Chromium
   build keeps getComputedStyle().color in oklch() notation rather than
   converting it to rgb(), so tokens are resolved by painting them onto a 1x1
   canvas and reading the pixel back: the browser's own colour engine has to do
   the real conversion, and a pixel buffer only ever holds plain numbers. A
   failure here means a palette change broke a floor in at least one theme.

   This is the gate a new theme has to pass. THEMES below is the one list to
   extend when you add a [data-theme] block, and it should stay in step with
   BUDGET_THEMES in renderer/lib/theme.js.

   Pass --report to print every measured ratio rather than only the failures,
   which is how the numbers quoted in app.css's comments are obtained.

   Run with:  npx electron tests/tokens-electron.cjs
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const root = path.join(__dirname, '..');
const REPORT = process.argv.includes('--report');
const THEMES = ['obsidian'];

// [label, foreground token, background token, minimum ratio]
//
// Every floor the THEME CONTRACT in renderer/app.css claims is enforced here,
// so a new theme block is checked against the whole contract rather than
// against whichever half someone remembered.
const CHECKS = [
  // The ink ramp, solved against --raised because that is the busiest text
  // backdrop and the tightest of the three surfaces. AA body text at 4.5:1.
  ['faint on raised',  '--faint',  '--raised', 4.5],
  ['muted on raised',  '--muted',  '--raised', 4.5],
  ['ink-2 on raised',  '--ink-2',  '--raised', 4.5],
  ['ink on raised',    '--ink',    '--raised', 4.5],
  // --on-ink is the foreground for anything FILLED with --ink, so the pair is
  // read in the reverse direction from the rest of the ramp.
  ['on-ink on ink',    '--on-ink', '--ink',    4.5],
  // --rule-strong carries the boundary or state of something interactive, so
  // WCAG 1.4.11 binds it at 3:1. --rule and --rule-faint are decorative, and
  // these two are regression guards rather than floors: they exist because
  // both were once left at 1.03-1.38:1, which is invisible rather than subtle.
  ['rule-strong on raised', '--rule-strong', '--raised', 3.0],
  ['rule on raised',        '--rule',        '--raised', 2.0],
  ['rule-faint on raised',  '--rule-faint',  '--raised', 1.7],
  ['breach on board',    '--breach',    '--board', 3.0],
  ['breach-ink on breach-soft', '--breach-ink', '--breach-soft', 4.5],
  // The primary button. --accent-btn exists precisely so this clears AA when
  // the raw --accent cannot carry --on-accent; a theme that skips the override
  // when it needed one fails here.
  ['on-accent on accent-btn', '--on-accent', '--accent-btn', 4.5],
  // The focus ring's solid 2px core, on the lightest surface it can land on.
  // WCAG 2.4.11 wants 3:1 for the indicator itself.
  ['accent ring on raised', '--accent', '--raised', 3.0],
  // The month bar's two internal boundaries: how far the plan extends against
  // the bare track, and where the spending ends against the plan. --bar-plan
  // is translucent, so both are measured as it actually lands - composited
  // over the --well it always sits on; see resolve() below.
  //
  // These are regression guards, NOT 1.4.11 floors, and they are the one pair
  // in this list that could not be floors. The solid accent is 5.10:1 against
  // the track in total, so 3:1 on either boundary is bought straight out of
  // the other; --bar-plan's own comment in app.css records both attempts and
  // why the middle setting is the one that ships. What these numbers exist to
  // catch is the plan drifting back toward either end - to 1.21:1 against the
  // track, which is invisible rather than quiet, or to 1.62:1 against the
  // spend, which is one violet slab in two weights.
  ['bar plan on track',   ['--bar-plan', '--well'], '--well', 1.9],
  ['spend on bar plan',   '--accent', ['--bar-plan', '--well'], 2.4],
  // The track's own outline, which now runs unbroken around the whole bar
  // (.bar-track::after in app.css) rather than only where the track is bare.
  // It was --rule-strong at a 3:1 floor while it was the only thing saying
  // how much room was left; the fills carry their own extent now, so this
  // stepped down to --rule and this became a guard rather than a floor.
  // --well and --board are within a percent of each other in obsidian, which
  // is exactly why an unoutlined empty track would read as no track, so the
  // guard is here to stop the line dimming toward nothing.
  ['bar track edge on board', '--rule', '--board', 2.4],
  // The income mark's tick (see .bar-mark-tick in app.css) lands on --board,
  // outside .bar-track's clip, and is the part of the mark that has to
  // actually be seen. This is the real WCAG floor for it, unlike the rule
  // that crosses the track fills. Same pair as the track edge above, checked
  // separately because the two would not move together: a theme is free to
  // give the track a different edge without touching the mark.
  ['mark on board', '--rule-strong', '--board', 3.0],
  // The accent washes that carry the Allocations table's three levels. These
  // are surfaces, not boundaries, and text sits ON them: --muted is the
  // lightest ink any of them has to hold (the group header's Savings pill and
  // the tray's "Add spend" label), so AA at 4.5:1 binds it. The washes are
  // mixed into --board, which is darker than the --raised the ink ramp was
  // solved against, so these should pass with room - they are here to catch a
  // theme that mixes a pale accent into a pale board and quietly loses the
  // labels sitting on top.
  ['muted on wash-head',   '--muted', '--wash-head',   4.5],
  ['muted on wash-tray',   '--muted', '--wash-tray',   4.5],
  ['muted on wash-open',   '--muted', '--wash-open',   4.5],
  ['breach-ink on wash-breach', '--breach-ink', '--wash-breach', 4.5],
  // The sidebar's own ramp. --panel is a separate surface from --board and
  // --raised (see the theme block comment in app.css), so every ink that lands
  // on it needs its own floor: the ink ramp is solved against --raised, and in
  // obsidian --panel is lighter than --raised, which spends contrast the ramp
  // was never measured to have. --muted is the tightest of the two, carrying
  // the brand subtitle and the "Household" label.
  ['ink-2 on panel', '--ink-2', '--panel', 4.5],
  ['muted on panel', '--muted', '--panel', 4.5],
  // The active nav item's fill against the panel behind it. A regression guard
  // rather than a WCAG floor, on the same reasoning as the bar's inner
  // boundary above: the active section is also carried by aria-current, a
  // weight-700 label and a filled icon, so 1.4.11's "information not otherwise
  // available" test does not bind this pair to 3:1. The tightest this step has
  // measured is 1.351:1; 1.3 is that rounded DOWN to one decimal place, so it
  // holds with the margin the design actually has. Obsidian is at 1.385:1.
  ['nav-active on panel', '--nav-active', '--panel', 1.3],
];

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const PAGE = (css, themes, checks) => `
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);

  const srgb = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => srgb(v / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
    return (hi + 0.05) / (lo + 0.05);
  };

  // Resolve a custom property to concrete sRGB numbers. getComputedStyle on
  // this Chromium build preserves the oklch() notation instead of converting
  // it to rgb(), so reading .color as a string is not enough: two different
  // oklch() values would both look unparsed. Painting the resolved colour
  // onto a 1x1 canvas and reading the pixel back forces the browser's own
  // colour engine to do the oklch-to-sRGB conversion; the pixel buffer only
  // ever holds concrete numbers, whatever notation produced them.
  // When a var() is invalid at computed-value time, 'color' is an inherited
  // property and so falls back to the PARENT's colour, and that fallback is
  // what the definedness check below compares against. The parent therefore
  // must not be a colour any token can hold: body carries color: var(--ink),
  // so probing --ink directly under body would read exactly like a token that
  // failed to resolve. The probe lives inside a host pinned to a sentinel no
  // palette would ever land on instead.
  const host = document.createElement('div');
  host.style.color = 'rgb(1, 2, 3)';
  document.body.appendChild(host);
  const probe = document.createElement('div');
  host.appendChild(probe);
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const rawOf = (token) => {
    // getPropertyValue on the property itself (not a probe using it) is the
    // reliable definedness check: an undefined custom property used in
    // var() falls back to the inherited colour rather than failing, so
    // checking the resolved .color would miss a genuinely missing token.
    const declared = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (!declared) throw new Error('undefined token: ' + token);

    // A token that exists but is not a colour (--shadow-sm, --ring, a later
    // CHECKS typo) is also invalid at computed-value time for the colour
    // property, and falls back to the same inherited value an undefined
    // token would. Read that inherited value with no override first, then
    // require the token to actually move .color away from it: this is a
    // second, independent check on the same failure mode as the
    // getPropertyValue guard above, not a substitute for it.
    probe.style.color = '';
    const inherited = getComputedStyle(probe).color;
    probe.style.color = 'var(' + token + ')';
    const raw = getComputedStyle(probe).color;
    if (raw === inherited) throw new Error('token did not resolve to a colour: ' + token);

    // ctx.fillStyle silently ignores a string it cannot parse and leaves
    // whatever colour was set before it, which would otherwise read back as
    // the previous token's pixel instead of failing. Seed a sentinel first
    // and require fillStyle to actually change away from it.
    ctx.fillStyle = '#010203';
    const sentinel = ctx.fillStyle;
    ctx.fillStyle = raw;
    if (ctx.fillStyle === sentinel) throw new Error('unparseable colour for ' + token + ': ' + raw);
    return raw;
  };

  // A check's foreground or background may be a [token, overToken] pair,
  // meaning "this token as it actually lands, composited over that one". A
  // bare token is painted on a cleared canvas, which reads a translucent
  // token at full strength and so answers a question nobody asked: --bar-plan
  // is a 50% accent and the number that matters is what it becomes over the
  // track it always sits on. getImageData hands back un-premultiplied RGBA,
  // so the alpha would otherwise just be dropped and the wash would measure
  // as the raw accent.
  //
  // clearRect still runs first either way: a shared canvas with the default
  // source-over compositing would let a translucent token pick up colour from
  // whatever pixel the previous resolve() call left behind, and the base of a
  // pair has to be the stated one rather than that leftover.
  const resolve = (spec) => {
    const [token, over] = Array.isArray(spec) ? spec : [spec, null];
    const raw = rawOf(token);
    const base = over ? rawOf(over) : null;

    ctx.clearRect(0, 0, 1, 1);
    if (base) { ctx.fillStyle = base; ctx.fillRect(0, 0, 1, 1); }
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  };

  const results = [];
  for (const theme of ${JSON.stringify(themes)}) {
    document.documentElement.setAttribute('data-theme', theme);
    for (const [label, fg, bg, min] of ${JSON.stringify(checks)}) {
      let ok = false, got = 0, err = '';
      try { got = ratio(resolve(fg), resolve(bg)); ok = got >= min; }
      catch (e) { err = e.message; }
      // Three decimals, not two: the derived floors below are stated as the
      // measured value rounded DOWN to one decimal, so re-deriving one needs
      // more precision than the floor itself carries.
      results.push({ theme, label, min, got: Number(got.toFixed(3)), ok, err });
    }
  }
  results;
`;

app.whenReady().then(async () => {
  let code = 0;
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    const css = fs.readFileSync(path.join(root, 'renderer', 'app.css'), 'utf8');
    await win.loadURL('data:text/html,<!doctype html><html><body></body></html>');
    const results = await win.webContents.executeJavaScript(PAGE(css, THEMES, CHECKS));

    if (REPORT) {
      for (const r of results) {
        console.log(
          `${r.ok ? 'pass' : 'FAIL'}  ${r.theme.padEnd(10)} ${r.label.padEnd(28)} ` +
          `${r.err || `${String(r.got).padStart(7)}:1  (floor ${r.min}:1)`}`
        );
      }
    }

    const failed = results.filter((r) => !r.ok);
    for (const r of failed) {
      console.error(`FAIL  ${r.theme.padEnd(10)} ${r.label}: ${r.err || `${r.got}:1 < ${r.min}:1`}`);
    }
    console.log(`${results.length - failed.length}/${results.length} contrast checks passed`);
    assert(failed.length === 0, `${failed.length} contrast checks failed`);
  } catch (e) {
    console.error(e.message);
    code = 1;
  } finally {
    win.destroy();
    app.exit(code);
  }
});
