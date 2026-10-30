/* ============================================================
   Newer-database test.

   A database written by a newer build (user_version above LATEST_VERSION)
   must be refused before anything runs against it, and the startup screen
   must say that, not blame another window or a sync program.

   1. Main: the real initDb, against a file database in a sandboxed userData,
      throws DatabaseTooNewError with both versions, and leaves the file as it
      found it: no WAL switch, no pre-migration backup, schema unchanged. The
      IPC envelope carries the code and versions across.
   2. Renderer: the store turns the refusal into a coded fatal error, and the
      startup screen shows the update copy, the two versions and the update
      banner for it, and the generic copy for anything else.

   Requires a prior `npm run build` (loads build/main/** and build/database/**).
   Run with:  npx electron tests/newer-database-electron.cjs
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Before anything reads it: initDb opens userData/data/budget.sqlite.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-newer-db-test-'));
app.setPath('userData', path.join(sandbox, 'userData'));

app.disableHardwareAcceleration();

const root = path.join(__dirname, '..');
const outDir = path.join(sandbox, 'page');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

const PAGE_SUITE = /* js */ `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { StoreProvider, useStore } from './renderer/store.jsx';
import { StartupErrorScreen } from './renderer/StartupError.jsx';

const results = [];
const check = (name, cond, msg) => results.push({ name, ok: !!cond, msg: cond ? '' : (msg || '') });
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

let updateStatus = { state: 'available', version: '9.9.0' };
window.api = {
  bootstrap: async () => ({ status: 'db_too_new', message: 'too new', found: 10, supported: 7 }),
  updateStatus: async () => updateStatus,
  onUpdateStatus: () => () => {},
  revealDataFolder: async () => {},
};

let store = null;
function Probe() { store = useStore(); return null; }

window.__runTests = async () => {
  /* ---- the store: a coded refusal becomes a coded fatal error --------- */
  const storeHost = document.createElement('div');
  document.body.appendChild(storeHost);
  createRoot(storeHost).render(createElement(StoreProvider, null, createElement(Probe)));
  await settle();
  const fatal = store && store.fatal;
  check('the store reports a fatal error', !!fatal);
  check('the fatal error is coded db_too_new', fatal && fatal.code === 'db_too_new', fatal && fatal.code);
  check('the fatal error carries both versions', fatal && fatal.found === 10 && fatal.supported === 7,
    fatal && JSON.stringify({ found: fatal.found, supported: fatal.supported }));
  check('the store never comes up', store && store.state === null);

  /* ---- the screen: update copy, versions, and the way to update ------- */
  const host = document.createElement('div');
  document.body.appendChild(host);
  const screen = createRoot(host);
  const show = async (error) => { flushSync(() => screen.render(createElement(StartupErrorScreen, { error, onRetry: () => {} }))); await settle(); };
  const text = () => host.textContent;

  await show(fatal);
  check('too new: says a newer version saved it', /saved by a newer version of House Budget/i.test(text()), text());
  check('too new: tells you to update', /update/i.test(text()), text());
  check('too new: names both versions', text().includes('10') && text().includes('7'), text());
  check('too new: does not blame another window', !/another window/i.test(text()), text());
  check('too new: does not blame a sync program', !/being synced/i.test(text()), text());
  check('too new: offers the update', !!host.querySelector('.update-banner') && text().includes('9.9.0'), text());

  await show(new Error('SQLITE_BUSY: database is locked'));
  check('other errors: keep the generic title', /couldn't open your data/i.test(text()), text());
  check('other errors: keep the generic body', /another window/i.test(text()), text());
  check('other errors: show the driver message', text().includes('SQLITE_BUSY'), text());
  check('other errors: no update banner', !host.querySelector('.update-banner'), text());

  return results;
};
`;

async function runPageSuite() {
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
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, sandbox: false } });
  try {
    const pageErrors = [];
    win.webContents.on('console-message', (...args) => {
      const e = args[0];
      const level = typeof e === 'object' && e ? e.level : args[1];
      const message = typeof e === 'object' && e ? e.message : args[2];
      // The store logs the bootstrap failure on purpose.
      if ((level === 'error' || level === 3) && !/bootstrap failed/.test(message)) pageErrors.push(message);
    });
    await win.loadFile(path.join(outDir, 'index.html'));
    const results = await win.webContents.executeJavaScript('window.__runTests()');
    assert(Array.isArray(results) && results.length > 0, 'the page suite returned nothing');
    const failed = results.filter((r) => !r.ok);
    for (const f of failed) console.error(`  FAIL ${f.name}${f.msg ? ` (${f.msg})` : ''}`);
    assert(failed.length === 0, `${failed.length}/${results.length} renderer assertions failed`);
    assert(pageErrors.length === 0, `console errors in the renderer: ${pageErrors.join(' | ')}`);
    return results.length;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    const Database = require('better-sqlite3');
    const b = (...p) => require(path.join(root, 'build', ...p));
    const { LATEST_VERSION, runMigrations } = b('database', 'migrations.js');
    const { initDb, closeDb, DatabaseTooNewError } = b('main', 'db.js');
    const { guard } = b('main', 'ipc', 'envelope.js');
    const paths = b('main', 'paths.js');

    /* ---- a database from the future ------------------------------------- */
    // Shaped unlike anything this build knows, so any query the build ran on
    // it would fail; the version is the only thing it should read.
    const found = LATEST_VERSION + 3;
    const file = paths.dbPath();
    const seed = new Database(file);
    seed.exec(`CREATE TABLE budget_months (id INTEGER PRIMARY KEY, month TEXT, from_the_future TEXT)`);
    seed.pragma(`user_version = ${found}`);
    seed.close();

    let thrown = null;
    try { initDb(); } catch (err) { thrown = err; }
    assert(thrown, 'initDb opened a database from a newer version');
    assert(DatabaseTooNewError && thrown instanceof DatabaseTooNewError,
      `initDb threw the wrong error: ${thrown && thrown.message}`);
    eq(thrown.code, 'db_too_new', 'error code');
    eq(thrown.detail && thrown.detail.found, found, 'found version');
    eq(thrown.detail && thrown.detail.supported, LATEST_VERSION, 'supported version');

    // Nothing ran against it.
    const after = new Database(file, { readonly: true });
    eq(after.pragma('journal_mode', { simple: true }), 'delete', 'journal mode (WAL means pragmas ran)');
    eq(after.pragma('user_version', { simple: true }), found, 'user_version');
    const tables = after.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all().map((r) => r.name);
    eq(JSON.stringify(tables), JSON.stringify(['budget_months']), 'tables (a migration or baseline ran)');
    after.close();
    const backups = fs.existsSync(paths.backupsDir()) ? fs.readdirSync(paths.backupsDir()) : [];
    eq(backups.length, 0, 'backups taken');

    // A retry is refused the same way, not served a half-open connection.
    let again = null;
    try { initDb(); } catch (err) { again = err; }
    assert(again instanceof DatabaseTooNewError, 'a second initDb did not refuse again');

    // The envelope carries the code and versions to the preload.
    const res = guard(() => initDb());
    eq(res.code, 'db_too_new', 'envelope code');
    eq(res.detail && res.detail.found, found, 'envelope found');
    eq(res.detail && res.detail.supported, LATEST_VERSION, 'envelope supported');

    /* ---- a current database still opens --------------------------------- */
    // Built here rather than by initDb's fresh path, which reads schema.sql
    // relative to the app path (tests/ under this runner).
    closeDb();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    const current = new Database(paths.dbPath());
    current.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));
    current.exec(fs.readFileSync(path.join(root, 'database', 'triggers.sql'), 'utf8'));
    current.pragma('user_version = 1');
    runMigrations(current);
    current.close();
    const db = initDb();
    eq(db.pragma('user_version', { simple: true }), LATEST_VERSION, 'a current database opens');
    eq(db.prepare('SELECT COUNT(*) AS n FROM budget_months').get().n, 0, 'a current database answers queries');
    closeDb();

    /* ---- the renderer ---------------------------------------------------- */
    const n = await runPageSuite();

    console.log(`NEWER_DB_OK main + ${n} renderer assertions`);
  } catch (err) {
    console.error('NEWER_DB_FAIL', err && err.message ? err.message : err);
    code = 1;
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});
