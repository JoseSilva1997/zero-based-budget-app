/* ============================================================
   The debug menu's full-page capture (main/ipc/debug.ts).

   The renderer half - drag, popover placement - is checked by running the app.
   What is worth pinning here is the part that touches the real OS window and
   the filesystem, and the one failure mode that would be genuinely annoying:
   a capture that throws mid-flight leaving the window stranded oversized.

   Loads a page whose .main overflows, captures it twice (once as-is, once
   grown), and asserts the grown shot is actually taller and the window came
   back to the size it started at both times.

   Requires a prior `npm run build` (loads build/main/ipc/debug.js).
   Run with:  npx electron tests/debug-screenshot-electron.cjs
   ============================================================ */
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const results = [];
function check(name, cond, msg) { results.push({ name, ok: !!cond, msg: cond ? '' : (msg || '') }); }

const WIDTH = 800;
const HEIGHT = 600;
const GROW = 200;

/* A .main that overflows its box, mirroring the app's own scroll container. */
const PAGE = `data:text/html,${encodeURIComponent(`
  <body style="margin:0;background:#101014">
    <div class="main" style="height:100vh;overflow-y:auto">
      <div style="height:2000px;background:linear-gradient(#1a3a6a,#6a1a3a)"></div>
    </div>
  </body>
`)}`;

/** Resolve once the window has put a real frame on screen. */
function firstPaint(win) {
  return win.webContents.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
  );
}

app.whenReady().then(async () => {
  const written = [];
  let win = null;
  try {
    const { captureWindow } = require(path.join(__dirname, '..', 'build', 'main', 'ipc', 'debug.js'));

    /* capturePage() reads the window's compositor surface, so the window has
       to be shown AND have painted once. Capturing before that first frame
       lands throws UnknownVizError - which it intermittently did while this
       test used `show: true` and captured straight after loadURL. Hence the
       full dance: subscribe to ready-to-show before load (it can fire while
       loadURL is still settling), show, then wait for a real frame. */
    win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false, backgroundColor: '#101014' });
    const readyToShow = new Promise((r) => win.once('ready-to-show', r));
    await win.loadURL(PAGE);
    await readyToShow;
    win.show();
    await firstPaint(win);

    const plainPath = await captureWindow(win, 0, 0);
    written.push(plainPath);
    check('plain shot written', fs.existsSync(plainPath), `nothing at ${plainPath}`);
    check('lands in a screenshots folder', path.basename(path.dirname(plainPath)) === 'screenshots',
      `wrote to ${path.dirname(plainPath)}`);
    check('named house-budget-<stamp>.png', /^house-budget-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.png$/.test(path.basename(plainPath)),
      `got ${path.basename(plainPath)}`);

    const head = fs.readFileSync(plainPath).subarray(0, 8);
    check('is a real PNG', head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      `magic bytes were ${head.toString('hex')}`);

    let size = win.getSize();
    check('size untouched by a no-grow capture', size[0] === WIDTH && size[1] === HEIGHT, `got ${size.join('x')}`);

    const grownPath = await captureWindow(win, 0, GROW);
    written.push(grownPath);
    check('grown shot written', fs.existsSync(grownPath), `nothing at ${grownPath}`);
    check('two captures did not collide on one filename', grownPath !== plainPath, 'same path twice');

    size = win.getSize();
    check('window restored after growing', size[0] === WIDTH && size[1] === HEIGHT, `left at ${size.join('x')}`);

    /* Image pixels are window points times the display scale factor, so the
       expected growth is scaled too. The tolerance is generous on purpose:
       this is asserting the window really grew, not pinning a device pixel. */
    const scale = screen.getPrimaryDisplay().scaleFactor || 1;
    const plainH = nativeImage.createFromPath(plainPath).getSize().height;
    const grownH = nativeImage.createFromPath(grownPath).getSize().height;
    check('grown shot is taller', grownH > plainH, `${grownH}px vs ${plainH}px`);
    check('taller by roughly the grow amount', Math.abs((grownH - plainH) - GROW * scale) < 24 * scale,
      `grew ${grownH - plainH}px, expected about ${GROW * scale}px at scale ${scale}`);

    /* A capture that fails must still put the window back. captureWindow only
       ever touches getSize/setSize/webContents, so a stand-in that delegates
       the first two to a real window and rejects on the third exercises the
       finally without needing a genuinely broken window. */
    const doomed = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false });
    await doomed.loadURL('data:text/html,<body></body>');
    doomed.show();
    const spoiled = {
      getSize: () => doomed.getSize(),
      setSize: (w, h) => doomed.setSize(w, h),
      webContents: {
        executeJavaScript: () => Promise.resolve(),
        capturePage: () => Promise.reject(new Error('boom')),
      },
    };
    let threw = false;
    try { await captureWindow(spoiled, 0, GROW); } catch { threw = true; }
    check('a failed capture propagates', threw, 'captureWindow swallowed the error');
    const after = doomed.getSize();
    check('window restored after a failed capture', after[0] === WIDTH && after[1] === HEIGHT, `left at ${after.join('x')}`);
    doomed.destroy();
  } catch (err) {
    check('suite ran', false, err && err.message ? err.message : String(err));
  } finally {
    for (const f of written) { try { fs.unlinkSync(f); } catch { /* best effort */ } }
    if (win && !win.isDestroyed()) win.destroy();
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of failed) console.error(`  FAIL ${r.name}${r.msg ? ` - ${r.msg}` : ''}`);
  if (failed.length) {
    console.error(`DEBUG_SHOT_FAIL ${failed.length}/${results.length} checks failed`);
    app.exit(1);
  } else {
    console.log(`DEBUG_SHOT_OK ${results.length} checks passed`);
    app.exit(0);
  }
});
