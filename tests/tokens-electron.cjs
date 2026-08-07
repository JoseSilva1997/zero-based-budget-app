/* ============================================================
   Contrast floors across all 12 themes.

   Loads renderer/app.css into a real hidden window, sets each data-theme in
   turn, and asserts the contrast ratios the design depends on. This Chromium
   build keeps getComputedStyle().color in oklch() notation rather than
   converting it to rgb(), so tokens are resolved by painting them onto a 1x1
   canvas and reading the pixel back: the browser's own colour engine has to
   do the real conversion, and a pixel buffer only ever holds plain numbers.
   A failure here means a palette change broke a WCAG floor in at least one
   theme.

   Run with:  npx electron tests/tokens-electron.cjs
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const root = path.join(__dirname, '..');
const THEMES = ['indigo', 'violet', 'cyan', 'emerald', 'mono', 'lime',
                'amber', 'rose', 'sky', 'ocean', 'teal', 'sunset'];

// [label, foreground token, background token, minimum ratio]
const CHECKS = [
  ['rule-strong on raised', '--rule-strong', '--raised', 3.0],
  ['unsettled on board', '--unsettled', '--board', 3.0],
  ['breach on board',    '--breach',    '--board', 3.0],
  ['breach-ink on breach-soft', '--breach-ink', '--breach-soft', 4.5],
  // The bar's outer boundary: how far the fill extends against its track.
  // This is the one WCAG 1.4.11 actually governs, so it stays at 3:1.
  ['bar fill faded on track', '--bar-faded', '--well', 3.0],
  // The bar's inner boundary, between its two fill intensities, is a
  // redundant encoding rather than the sole carrier of the amounts it
  // represents: MonthBar prints "spent" and "allocated" as text beneath
  // the bar, so 1.4.11's "information not otherwise available" test does
  // not bind this pair to 3:1. contrast(--accent, --well) is under the
  // 9:1 that two stacked 3:1 floors would require in 8 of the 12 themes
  // (ratios multiply: outer x inner = total, so a total under 9 cannot
  // hold two 3:1 floors at once), which is why this floor is derived
  // rather than picked.
  //
  // Derivation: --bar-faded's mix percentage is the smallest whole number
  // that clears the outer floor above in every theme (raising it lightens
  // --bar-faded, which raises the outer ratio and lowers this one, so the
  // smallest percentage that clears the outer floor also maximises this
  // one). That is 74% (see renderer/app.css). At 74%, the worst case
  // across all 12 themes is indigo at 1.503:1. 1.5 is that value rounded
  // DOWN to one decimal place, so it holds with the same margin the design
  // actually has, not a hair over it. A change to --accent or --well that
  // erodes this ratio below 1.5 is a real regression: it means the two
  // fills are collapsing toward being indistinguishable.
  ['bar fill solid on faded', '--accent',    '--bar-faded', 1.5],
  // The income mark's tick (see .bar-mark-tick in app.css) lands on --board,
  // outside .bar-track's clip, and is the part of the mark that has to
  // actually be seen. This is the real WCAG floor for it, unlike the rule
  // that crosses the track fills.
  ['mark on board', '--rule-strong', '--board', 3.0],
  // The bar's inner boundary between 'gap' and 'allocated' (--unsettled vs
  // --bar-faded) is a redundant encoding, same reasoning as the derived
  // floor above: the amounts are printed as text beneath the bar, so 1.4.11
  // does not bind this pair to 3:1. Measured worst case is lime at
  // 1.3988:1; 1.3 is that value rounded DOWN to one decimal place. This is
  // a regression guard, not a WCAG floor: it exists to catch this pair
  // collapsing further, not to certify it as accessible on its own.
  ['unsettled on bar-faded', '--unsettled', '--bar-faded', 1.3],
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
  const probe = document.createElement('div');
  document.body.appendChild(probe);
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const resolve = (token) => {
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

    // clearRect before painting: a shared canvas with the default
    // source-over compositing would let a translucent token pick up colour
    // from whatever pixel the previous resolve() call left behind.
    ctx.clearRect(0, 0, 1, 1);
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
      results.push({ theme, label, min, got: Number(got.toFixed(2)), ok, err });
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

    const failed = results.filter((r) => !r.ok);
    for (const r of failed) {
      console.error(`FAIL  ${r.theme.padEnd(8)} ${r.label}: ${r.err || `${r.got}:1 < ${r.min}:1`}`);
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
