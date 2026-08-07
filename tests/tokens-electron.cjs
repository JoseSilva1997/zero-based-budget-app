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
  ['border-strong on surface', '--border-strong', '--surface', 3.0],
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
