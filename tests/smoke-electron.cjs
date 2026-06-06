/* ============================================================
   Electron main-process smoke test: loads the freshly-rebuilt
   better-sqlite3 under Electron's ABI, opens an in-memory DB, runs the
   bundled schema + triggers, and exits. No window is shown. A non-zero
   exit (or a NODE_MODULE_VERSION error) means the native rebuild did not
   match Electron's ABI.

   Run with:  npx electron tests/smoke-electron.cjs
   ============================================================ */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema'), 'utf8'));
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'triggers'), 'utf8'));
    const v = db.prepare('SELECT sqlite_version() AS v').get().v;
    const tables = db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`)
      .get().n;
    console.log(
      `SMOKE_OK sqlite=${v} tables=${tables} electron=${process.versions.electron} abi=${process.versions.modules}`
    );
    db.close();
    process.exitCode = 0;
  } catch (err) {
    console.error('SMOKE_FAIL', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
