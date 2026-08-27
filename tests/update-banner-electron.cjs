/* ============================================================
   UpdateBanner renderer test.

   Mounts the real component in a hidden BrowserWindow against a fake
   window.api, and drives it through every updater status. The point of the
   suite is what the banner does NOT do: an available update renders an offer
   and fetches nothing, so no bytes move until the Download button is clicked.

   esbuild compiles the JSX (the same bundler the app ships with); React runs
   in a real DOM, so effects, clicks and per-version dismissal all behave as
   they do in the app. The last block is a placement check on main.jsx: the
   banner belongs in the sidebar foot, not floating over the content.

   Run with:  npx electron tests/update-banner-electron.cjs
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const root = path.join(__dirname, '..');
const outDir = path.join(app.getPath('temp'), 'house-budget-banner-test');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/* renderer/app.css is a manifest of @imports over renderer/styles/*.css, so a
   text search for a rule has to follow them. */
function readCss(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/@import\s+"([^"]+)";/g, (_m, rel) => readCss(path.join(path.dirname(file), rel)));
}

/* ---- the page-side suite ------------------------------------------------
   Bundled and run inside the window. Returns [{ name, ok, msg }]; the main
   process decides the exit code from that.
   -------------------------------------------------------------------- */
const PAGE_SUITE = /* js */ `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { UpdateBanner } from './renderer/UpdateBanner.jsx';

const results = [];
const check = (name, cond, msg) => results.push({ name, ok: !!cond, msg: cond ? '' : (msg || '') });
const tick = () => new Promise((r) => setTimeout(r, 0));

// Fake preload bridge. push() delivers a status the way the main process
// would; the counters prove which IPC calls the banner actually makes.
const calls = { status: 0, download: 0, install: 0, check: 0 };
let push = () => {};
window.api = {
  updateStatus: async () => { calls.status += 1; return { state: 'idle' }; },
  onUpdateStatus: (handler) => { push = handler; return () => { push = () => {}; }; },
  updateDownload: async () => { calls.download += 1; return { data: { state: 'downloading' } }; },
  updateInstall: async () => { calls.install += 1; return { data: { ok: true } }; },
  updateCheck: async () => { calls.check += 1; return { state: 'none' }; },
};

const host = document.getElementById('root');
const banner = () => host.querySelector('.update-banner');
const text = () => (banner() ? banner().textContent : '');
const buttonNamed = (label) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === label);

// Clicking a button that is not there is a failed assertion, not a crash that
// hides every check after it.
const clickNamed = (label) => {
  const button = buttonNamed(label);
  check('button "' + label + '" is clickable', !!button, 'banner text: ' + text());
  if (button) button.click();
};

async function setStatus(status) {
  push(status);
  await tick();
  await tick();
}

window.__runTests = async () => {
  createRoot(host).render(createElement(UpdateBanner));
  await tick();
  await tick();

  /* ---- silent states -------------------------------------------------- */
  check('idle renders nothing', banner() === null);
  for (const status of [{ state: 'checking' }, { state: 'none' }, { state: 'error', message: 'offline' }]) {
    await setStatus(status);
    check(status.state + ' renders nothing', banner() === null,
      'the banner must not interrupt someone who never asked about updates');
  }

  /* ---- available: an offer, not a download ---------------------------- */
  await setStatus({ state: 'available', version: '1.0.3' });
  check('available shows the banner', banner() !== null);
  check('available names the version', text().includes('1.0.3'), text());
  check('available says ready to download', /ready to download/i.test(text()), text());
  check('available offers a Download button', !!buttonNamed('download'), text());
  check('available offers a dismissal', !!buttonNamed('not now'), text());
  check('available downloads nothing', calls.download === 0,
    'showing the offer must not fetch the installer');
  check('available cannot install', !buttonNamed('restart now'), text());

  /* ---- the click is what starts the transfer -------------------------- */
  clickNamed('download');
  await tick();
  check('clicking Download calls updateDownload once', calls.download === 1, 'got ' + calls.download);
  check('clicking Download does not install', calls.install === 0);

  /* ---- downloading ---------------------------------------------------- */
  await setStatus({ state: 'downloading', version: '1.0.3', percent: 55 });
  check('downloading shows progress text', /downloading/i.test(text()), text());
  const bar = host.querySelector('.update-banner-bar');
  check('downloading renders a progress bar', !!bar);
  // The bar is filled by a transform, not a width, so a progress push cannot
  // re-lay out the sidebar around it. --pct carries the fraction to the scale.
  check('progress bar tracks the percent', bar && bar.style.getPropertyValue('--pct') === '0.55',
    bar && bar.style.getPropertyValue('--pct'));
  check('downloading has no action buttons', host.querySelectorAll('button').length === 0);

  /* ---- downloaded ----------------------------------------------------- */
  await setStatus({ state: 'downloaded', version: '1.0.3' });
  check('downloaded says ready to install', /ready to install/i.test(text()), text());
  check('downloaded offers Restart now', !!buttonNamed('restart now'), text());
  clickNamed('restart now');
  await tick();
  check('clicking Restart now calls updateInstall once', calls.install === 1, 'got ' + calls.install);
  check('restarting starts no further download', calls.download === 1, 'got ' + calls.download);

  /* ---- dismissal is per version --------------------------------------- */
  await setStatus({ state: 'available', version: '1.0.4' });
  clickNamed('not now');
  await tick();
  check('dismissing hides the banner', banner() === null);
  check('dismissing downloads nothing', calls.download === 1, 'got ' + calls.download);
  await setStatus({ state: 'downloaded', version: '1.0.4' });
  check('dismissal silences that version', banner() === null,
    'a dismissed version should stay dismissed through its later statuses');
  await setStatus({ state: 'available', version: '1.0.5' });
  check('a newer version is not silenced', banner() !== null && text().includes('1.0.5'), text());

  /* ---- the banner pulls the status it missed while mounting ----------- */
  check('mount pulls the current status', calls.status === 1, 'got ' + calls.status);

  return results;
};
`;

app.whenReady().then(async () => {
  let win = null;
  try {
    /* ---- placement: sidebar foot, not a floating card ------------------- */
    const mainJsx = fs.readFileSync(path.join(root, 'renderer', 'main.jsx'), 'utf8');
    const sidebar = mainJsx.slice(mainJsx.indexOf('className="sidebar-foot"'), mainJsx.indexOf('</aside>'));
    assert(sidebar.length > 0, 'renderer/main.jsx no longer has a .sidebar-foot inside the aside');
    assert(sidebar.includes('<UpdateBanner'), 'UpdateBanner must render inside the sidebar foot');
    assert(
      sidebar.indexOf('<UpdateBanner') < sidebar.indexOf('>Household<'),
      'UpdateBanner belongs above the Household label'
    );
    assert(
      mainJsx.split('<UpdateBanner').length === 2,
      'UpdateBanner should be mounted exactly once'
    );

    const bannerSrc = fs.readFileSync(path.join(root, 'renderer', 'UpdateBanner.jsx'), 'utf8');
    assert(!/position:\s*'fixed'/.test(bannerSrc), 'the banner should sit in the sidebar, not float over the app');

    /* The banner's rules live in renderer/styles/shell.css now; app.css is the
       @import manifest over that folder. Read the manifest and the files it
       names, so this check keeps asking "is the rule in the stylesheet" rather
       than "is it in this one file". */
    const css = readCss(path.join(root, 'renderer', 'app.css'));
    for (const cls of ['.update-banner', '.update-banner-bar', '.update-banner-actions']) {
      assert(css.includes(cls), `the renderer stylesheet is missing ${cls}`);
    }

    /* ---- bundle the suite + component ----------------------------------- */
    fs.mkdirSync(outDir, { recursive: true });
    await esbuild.build({
      stdin: { contents: PAGE_SUITE, resolveDir: root, loader: 'jsx', sourcefile: 'suite.jsx' },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome120',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      outfile: path.join(outDir, 'suite.js'),
    });
    fs.writeFileSync(
      path.join(outDir, 'index.html'),
      '<!DOCTYPE html><html><body><div id="root"></div><script src="suite.js"></script></body></html>',
      'utf8'
    );

    /* ---- run it in a hidden window -------------------------------------- */
    win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, sandbox: false } });
    const pageErrors = [];
    win.webContents.on('console-message', (...args) => {
      // Electron 41 passes an event object; older builds pass positional args.
      const e = args[0];
      const level = typeof e === 'object' && e ? e.level : args[1];
      const message = typeof e === 'object' && e ? e.message : args[2];
      if (level === 'error' || level === 3) pageErrors.push(message);
    });
    await win.loadFile(path.join(outDir, 'index.html'));
    const results = await win.webContents.executeJavaScript('window.__runTests()');

    assert(Array.isArray(results) && results.length > 0, 'the page suite returned nothing');
    const failed = results.filter((r) => !r.ok);
    for (const f of failed) console.error(`  FAIL ${f.name}${f.msg ? ` (${f.msg})` : ''}`);
    assert(failed.length === 0, `${failed.length}/${results.length} banner assertions failed`);
    assert(pageErrors.length === 0, `console errors in the renderer: ${pageErrors.join(' | ')}`);

    console.log(`BANNER_OK ${results.length} assertions`);
    process.exitCode = 0;
  } catch (err) {
    console.error('BANNER_FAIL', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(outDir, { recursive: true, force: true });
    app.quit();
  }
});
