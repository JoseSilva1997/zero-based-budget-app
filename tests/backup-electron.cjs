/* ============================================================
   Backup settings test. Covers how the automatic-backup setting is read and
   written now that 'daily' is gone: a stored 'daily' (from an install that
   picked it, or carried in by restoring an old backup) must keep backing up
   on close rather than silently stop, and settings:update must refuse it.

   Requires a prior `npm run build` (loads build/database/** and build/main/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     npx electron tests/backup-electron.cjs
   ============================================================ */
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    const Database = require('better-sqlite3');
    const root = path.join(__dirname, '..');
    const b = (...p) => require(path.join(root, 'build', ...p));
    const { runMigrations } = b('database', 'migrations.js');
    const meta = b('database', 'repositories', 'meta.js');
    const { loadBootstrap } = b('database', 'repositories', 'bootstrap.js');

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));
    db.exec(fs.readFileSync(path.join(root, 'database', 'triggers.sql'), 'utf8'));
    db.pragma('user_version = 1');
    runMigrations(db);

    /* ---- readAutoBackupMode: only an explicit 'off' turns backups off ---- */
    eq(meta.readAutoBackupMode(db), 'onclose', 'unset reads as the default');
    for (const [stored, want] of [
      ['onclose', 'onclose'],
      ['off', 'off'],
      ['daily', 'onclose'], // the retired option keeps backing up
      ['weekly', 'onclose'], // anything unknown falls back to the default
    ]) {
      meta.setMeta(db, 'autoBackup', stored);
      eq(meta.readAutoBackupMode(db), want, `stored '${stored}'`);
    }

    /* ---- bootstrap hands the renderer the normalised value ---- */
    meta.setMeta(db, 'autoBackup', 'daily');
    eq(loadBootstrap(db).settings.autoBackup, 'onclose', 'bootstrap normalises daily');
    db.close();

    /* ---- settings:update refuses anything but off / onclose ---- */
    // Captured rather than registered, the same way updater-electron.cjs does
    // it. The refusal happens before the handler touches the database, so no
    // live DB is needed here.
    const handlers = new Map();
    ipcMain.handle = (channel, fn) => handlers.set(channel, fn);
    b('main', 'ipc', 'settings.js').registerSettingsIpc();
    const update = handlers.get('settings:update');
    const res = await update({}, { patch: { autoBackup: 'daily' } });
    eq(typeof res.error, 'string', 'daily is refused');
    eq(res.error.includes('daily'), true, 'refusal names the value');

    console.log('BACKUP_OK auto-backup setting verified');
  } catch (err) {
    console.error('BACKUP_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});
