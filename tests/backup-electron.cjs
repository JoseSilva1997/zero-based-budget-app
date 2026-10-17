/* ============================================================
   Backup test.

   1. The automatic-backup setting now that 'daily' is gone: a stored 'daily'
      (from an install that picked it, or carried in by restoring an old
      backup) must keep backing up on close rather than silently stop, and
      settings:update must refuse it.
   2. The cloud backup folder, against temp folders standing in for a synced
      one: local always first, a cloud failure never fails a backup, the
      marker guard, per-device pruning, catch-up, and restore staging.

   Requires a prior `npm run build` (loads build/database/** and build/main/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     npx electron tests/backup-electron.cjs
   ============================================================ */
const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Before anything reads it: the cloud service keeps its per-machine config and
// staging folder under userData, and this run must not touch the real one.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-backup-test-'));
app.setPath('userData', path.join(sandbox, 'userData'));

app.disableHardwareAcceleration();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
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

    await cloudFolderChecks(b, sandbox);
    await cloudServiceChecks(b, sandbox);

    console.log('BACKUP_OK auto-backup setting and cloud folder verified');
  } catch (err) {
    console.error('BACKUP_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    fs.rmSync(sandbox, { recursive: true, force: true });
    app.exit(code);
  }
});

/** A small real House Budget database, the thing every backup is a copy of. */
function makeDb(b, file) {
  const Database = require('better-sqlite3');
  const root = path.join(__dirname, '..');
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(root, 'database', 'triggers.sql'), 'utf8'));
  db.pragma('user_version = 1');
  b('database', 'migrations.js').runMigrations(db);
  b('database', 'repositories', 'months.js').insertMonth(db, '2026-10');
  return db;
}

/* ---- the file layer: database/repositories/cloudFolder ---- */
async function cloudFolderChecks(b, sandbox) {
  const cf = b('database', 'repositories', 'cloudFolder.js');
  const backups = b('database', 'repositories', 'backups.js');
  const dir = path.join(sandbox, 'repo');
  const localDir = path.join(dir, 'local');
  const picked = path.join(dir, 'Dropbox');
  fs.mkdirSync(localDir, { recursive: true });
  fs.mkdirSync(picked, { recursive: true });

  /* device names are valid folder names on Windows and Linux */
  eq(cf.safeDeviceName('jose-laptop'), 'jose-laptop', 'plain name kept');
  eq(cf.safeDeviceName('a:b/c\\d?'), 'a-b-c-d-', 'reserved characters replaced');
  eq(cf.safeDeviceName('.hidden. '), 'hidden', 'no leading dot, no trailing dot or space');
  eq(cf.safeDeviceName(''), 'this-computer', 'empty falls back');

  /* preparing: a House Budget folder with a marker, reused when picked again */
  let threw = false;
  try { cf.prepareCloudFolder(path.join(dir, 'missing')); } catch { threw = true; }
  assert(threw, 'a missing folder is refused');
  const root = cf.prepareCloudFolder(picked);
  eq(root, path.join(picked, cf.APP_FOLDER), 'root is a House Budget folder inside the pick');
  assert(cf.isFolderReady(root), 'marker written');
  eq(cf.prepareCloudFolder(root), root, 'picking the House Budget folder itself reuses it');

  /* mirroring: copied, no .tmp left, snapshot date kept, re-run is a no-op */
  const db = makeDb(b, path.join(dir, 'live.sqlite'));
  const info = await backups.createDbBackup(db, localDir);
  db.close();
  const old = new Date('2026-01-02T03:04:05Z');
  fs.utimesSync(info.path, old, old);
  eq(await cf.mirrorBackup(info.path, root, 'laptop'), 'copied', 'first copy');
  const copy = path.join(root, 'laptop', info.fileName);
  assert(fs.existsSync(copy), 'copy is in the device folder');
  eq(fs.readdirSync(path.join(root, 'laptop')).filter((f) => f.endsWith('.tmp')).length, 0, 'no .tmp left');
  eq(fs.statSync(copy).mtimeMs, old.getTime(), 'copy keeps the snapshot date');
  eq(await cf.mirrorBackup(info.path, root, 'laptop'), 'present', 'second copy is a no-op');

  /* the marker guard: no marker, no copy, and the local file is untouched */
  const markerFile = path.join(root, cf.MARKER);
  fs.renameSync(markerFile, markerFile + '.away');
  let refused = null;
  try { await cf.mirrorBackup(info.path, root, 'laptop'); } catch (e) { refused = e.message; }
  eq(refused, cf.NOT_READY, 'missing marker refuses the copy');
  assert(fs.existsSync(info.path), 'local backup untouched');
  eq(cf.listCloudBackups(root).length, 0, 'an unready folder lists nothing');
  fs.renameSync(markerFile + '.away', markerFile);

  /* a mount that lists IDs instead of names (GNOME's Google Drive): refused
     when chosen, with what it made removed, and refused before a copy */
  const gdrive = path.join(dir, 'GDrive');
  fs.mkdirSync(gdrive);
  const realReaddir = fs.readdirSync;
  const listsIds = (p) => path.resolve(String(p)).startsWith(gdrive) || path.resolve(String(p)) === root;
  fs.readdirSync = function (p, ...rest) {
    return listsIds(p) ? ['1d5T3o4gkWW9K9ZnCNTTQZWRwWbICgFZV'] : realReaddir.call(this, p, ...rest);
  };
  try {
    let msg = null;
    try { cf.prepareCloudFolder(gdrive); } catch (e) { msg = e.message; }
    eq(msg, cf.NOT_LISTABLE, 'a folder that lists IDs is refused');
    assert(!fs.existsSync(path.join(gdrive, cf.APP_FOLDER)), 'the refused folder is left as it was');
    eq(cf.folderProblem(root), cf.NOT_LISTABLE, 'an already-chosen ID-listing folder is reported');
    msg = null;
    try { await cf.mirrorBackup(info.path, root, 'laptop'); } catch (e) { msg = e.message; }
    eq(msg, cf.NOT_LISTABLE, 'and refused before a copy');
  } finally {
    fs.readdirSync = realReaddir;
  }
  eq(cf.folderProblem(root), null, 'a normal folder has no problem');

  /* pruning: this device only, this app's files only, stale .tmp cleared */
  const dev = path.join(root, 'laptop');
  const other = path.join(root, 'desktop');
  fs.mkdirSync(other, { recursive: true });
  for (const n of ['2026-01-01T000000', '2026-01-02T000000', '2026-01-03T000000']) {
    fs.copyFileSync(info.path, path.join(dev, `budget-${n}.sqlite`));
    fs.copyFileSync(info.path, path.join(other, `budget-${n}.sqlite`));
  }
  fs.writeFileSync(path.join(dev, 'notes.txt'), 'mine');
  fs.writeFileSync(path.join(dev, 'budget-stale.sqlite.tmp'), 'x');
  fs.writeFileSync(path.join(dev, 'budget-fresh.sqlite.tmp'), 'x');
  const ancient = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(path.join(dev, 'budget-stale.sqlite.tmp'), ancient, ancient);
  cf.pruneCloud(root, 'laptop', 2);
  const left = fs.readdirSync(dev).sort();
  eq(left.filter((f) => f.endsWith('.sqlite')).length, 2, 'device folder pruned to 2');
  assert(!left.includes('budget-2026-01-01T000000.sqlite'), 'oldest pruned first');
  assert(left.includes('notes.txt'), 'a file the app did not make is never deleted');
  assert(!left.includes('budget-stale.sqlite.tmp'), 'stale .tmp cleared');
  assert(left.includes('budget-fresh.sqlite.tmp'), 'an in-flight .tmp is left alone');
  eq(fs.readdirSync(other).length, 3, "another device's folder is never pruned");

  /* listing: every device, newest first; isInside */
  const listed = cf.listCloudBackups(root);
  assert(listed.every((x) => x.source === 'cloud'), 'cloud entries are marked');
  assert(listed.some((x) => x.device === 'desktop'), "other devices' backups listed");
  assert(cf.isInside(copy, root), 'a cloud file is inside the root');
  assert(!cf.isInside(info.path, root), 'a local file is not');
  assert(!cf.isInside(root, root), 'the root itself is not inside itself');

  /* catch-up: copies only what the cloud folder is missing */
  const fresh = path.join(dir, 'Fresh');
  fs.mkdirSync(fresh);
  const root2 = cf.prepareCloudFolder(fresh);
  fs.copyFileSync(info.path, path.join(localDir, 'budget-2026-02-01T000000.sqlite'));
  eq(await cf.catchUp(localDir, root2, 'laptop'), 2, 'catch-up copies both local backups');
  eq(await cf.catchUp(localDir, root2, 'laptop'), 0, 'a second catch-up copies nothing');

  /* staging: same name and date, readable by the restore checks */
  const staged = cf.stageForRestore(copy, path.join(dir, 'staging'));
  eq(path.basename(staged), info.fileName, 'staged copy keeps its name');
  eq(fs.statSync(staged).mtimeMs, fs.statSync(copy).mtimeMs, 'staged copy keeps its date');
  assert(!cf.isInside(staged, root), 'staged copy is local');
  eq(backups.inspectBackupFile(staged).months, 1, 'staged copy passes the restore checks');
}

/* ---- the service: main/cloudBackup (local first, failures reported) ---- */
async function cloudServiceChecks(b, sandbox) {
  const svc = b('main', 'cloudBackup.js');
  const paths = b('main', 'paths.js');
  const dir = path.join(sandbox, 'svc');
  const picked = path.join(dir, 'OneDrive');
  fs.mkdirSync(picked, { recursive: true });
  const db = makeDb(b, path.join(dir, 'live.sqlite'));
  const meta = b('database', 'repositories', 'meta.js');

  /* off by default: a backup is local only */
  eq(svc.cloudStatus().folder, null, 'no cloud folder until one is chosen');
  let res = await svc.backupNow(db);
  assert(fs.existsSync(res.info.path), 'local backup written');
  assert(res.info.path.startsWith(paths.backupsDir()), 'local backup is in the backups folder');
  eq(res.cloud.state, 'off', 'no cloud copy when off');
  eq(meta.getMeta(db, 'lastBackup'), res.info.savedAt, 'lastBackup set');

  /* choosing a folder copies the existing backup across straight away */
  const st = await svc.chooseCloudFolder(picked);
  assert(st.ready, 'folder ready');
  assert(st.device, 'device named');
  assert(fs.existsSync(path.join(st.folder, st.device, res.info.fileName)), 'existing backup caught up');
  assert(fs.existsSync(paths.cloudConfigPath()), 'config is a file in userData, not in the database');

  /* a cloud failure never fails the backup */
  const marker = path.join(st.folder, '.house-budget');
  fs.renameSync(marker, marker + '.away');
  await new Promise((r) => setTimeout(r, 1100)); // a new second, so a new snapshot name
  res = await svc.backupNow(db);
  assert(fs.existsSync(res.info.path), 'local backup still written');
  eq(res.cloud.state, 'failed', 'cloud copy reported as failed');
  assert(svc.cloudStatus().lastError, 'failure recorded for Settings');
  fs.renameSync(marker + '.away', marker);

  /* the startup catch-up repairs it and clears the error */
  eq((await svc.catchUpCloud()).state, 'copied', 'catch-up succeeds once reachable');
  assert(fs.existsSync(path.join(st.folder, st.device, res.info.fileName)), 'missed backup copied');
  eq(svc.cloudStatus().lastError, null, 'error cleared');

  /* restore candidates: cloud files are staged, local files are not */
  const cloudFile = path.join(st.folder, st.device, res.info.fileName);
  const staged = svc.localPathFor(cloudFile);
  assert(staged.startsWith(paths.restoreStagingDir()), 'cloud file staged locally');
  eq(svc.localPathFor(res.info.path), res.info.path, 'local file used as is');

  /* stopping keeps the device name and the files already copied */
  const device = st.device;
  const after = svc.disconnectCloud();
  eq(after.folder, null, 'folder cleared');
  eq(after.device, device, 'device name kept for next time');
  assert(fs.existsSync(cloudFile), 'cloud files left alone');
  eq((await svc.backupNow(db)).cloud.state, 'off', 'backups are local only again');
  db.close();
}
