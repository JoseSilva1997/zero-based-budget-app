/* ============================================================
   Auto-update main-process test.

   Covers the rule the app now lives by: a check never downloads anything.
   The updater reports 'available' and stops there; bytes only move when
   downloadUpdate() is called, which only the user's click reaches.

   electron-updater is replaced in the require cache with a fake autoUpdater
   (an EventEmitter with the three methods the module calls), so the whole
   state machine runs without a network, a release feed or a real installer.
   app.isPackaged is forced on, because the updater disables itself in dev.

   Requires a prior `npm run build` (loads build/main/**).
   Run with:  npx electron tests/updater-electron.cjs
   ============================================================ */
const { app, BrowserWindow, ipcMain } = require('electron');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

/* ---- fake electron-updater ---------------------------------------------- */

/**
 * Stands in for electron-updater's autoUpdater. checkForUpdates and
 * downloadUpdate run whatever `script` the current test installed, which is
 * how the real event sequence (checking -> available, progress -> downloaded)
 * is reproduced from inside the awaited call.
 */
function makeFakeUpdater() {
  const fake = new EventEmitter();
  fake.autoDownload = true;              // the module must turn this off
  fake.autoInstallOnAppQuit = false;
  fake.forceDevUpdateConfig = false;
  fake.calls = { check: 0, download: 0, install: [] };
  fake.script = { check: null, download: null };

  fake.checkForUpdates = async () => {
    fake.calls.check += 1;
    if (fake.script.check) await fake.script.check();
    return null;
  };
  fake.downloadUpdate = async () => {
    fake.calls.download += 1;
    fake.downloadSawBroadcasts = sent.length; // what the UI knew before the fetch
    if (fake.script.download) await fake.script.download();
    return [];
  };
  fake.quitAndInstall = (isSilent, isForceRunAfter) => {
    fake.calls.install.push([isSilent, isForceRunAfter]);
  };
  return fake;
}

/** Every status the main process pushed at the renderer, in order. */
const sent = [];

function lastSent() {
  return sent[sent.length - 1];
}
function lastOf(list) {
  return list[list.length - 1];
}

/* ---- harness ------------------------------------------------------------ */

// The updater only arms itself in a packaged app; both of these are plain
// properties on the module object the updater imports, so overriding them here
// is what build/main/updater.js will see.
Object.defineProperty(app, 'isPackaged', { get: () => true, configurable: true });
BrowserWindow.getAllWindows = () => [
  { isDestroyed: () => false, webContents: { send: (channel, status) => sent.push({ channel, status }) } },
];

const fake = makeFakeUpdater();
const updaterModule = require.resolve('electron-updater');
require.cache[updaterModule] = {
  id: updaterModule,
  filename: updaterModule,
  loaded: true,
  paths: [],
  children: [],
  exports: { autoUpdater: fake },
};

app.whenReady().then(async () => {
  try {
    const buildDir = path.join(__dirname, '..', 'build');
    const updater = require(path.join(buildDir, 'main', 'updater.js'));
    const { registerUpdaterIpc } = require(path.join(buildDir, 'main', 'ipc', 'updater.js'));

    /* ---- 1. init leaves downloads switched off -------------------------- */
    updater.initUpdater();
    eq(fake.autoDownload, false, 'initUpdater must disable autoDownload');
    eq(fake.autoInstallOnAppQuit, true, 'a downloaded update should still install on quit');
    eq(fake.calls.download, 0, 'init must not start a download');

    /* ---- 2. nothing available ------------------------------------------- */
    fake.script.check = () => {
      fake.emit('checking-for-update');
      fake.emit('update-not-available', { version: '1.0.2' });
    };
    let status = await updater.checkForUpdates();
    eq(status.state, 'none', 'check with no newer release');
    eq(sent.length, 2, 'checking + none should both reach the renderer');
    eq(sent[0].channel, 'updater:status', 'push channel');
    eq(sent[0].status.state, 'checking', 'first push');
    eq(fake.calls.download, 0, 'a check that finds nothing must not download');

    /* ---- 3. an update exists: offered, NOT fetched ----------------------- */
    // The regression this suite exists for. Before, autoDownload meant the
    // startup check pulled the installer with nobody asking.
    sent.length = 0;
    fake.script.check = () => {
      fake.emit('checking-for-update');
      fake.emit('update-available', { version: '1.0.3' });
    };
    status = await updater.checkForUpdates();
    eq(status.state, 'available', 'check that finds a release');
    eq(status.version, '1.0.3', 'offered version');
    eq(fake.calls.download, 0, 'the check must not download the update');
    eq(lastSent().status.state, 'available', 'renderer is told an update is available');
    eq(lastSent().status.version, '1.0.3', 'renderer is told which version');

    // Nothing is installable yet either, so a stray install is a no-op.
    updater.installUpdate();
    eq(fake.calls.install.length, 0, 'install before download must do nothing');

    /* ---- 4. the download happens only when asked for --------------------- */
    sent.length = 0;
    fake.script.download = () => {
      fake.emit('download-progress', { percent: 42.4 });
      fake.emit('update-downloaded', { version: '1.0.3' });
    };
    status = await updater.downloadUpdate();
    eq(fake.calls.download, 1, 'downloadUpdate starts exactly one transfer');
    eq(status.state, 'downloaded', 'state after the transfer finishes');

    // The banner must flip to "downloading" on the click, not once the first
    // progress event happens to arrive.
    eq(sent[0].status.state, 'downloading', 'first push after the click');
    eq(sent[0].status.percent, 0, 'download starts the UI at 0%');
    eq(sent[0].status.version, '1.0.3', 'downloading status carries the version');
    eq(fake.downloadSawBroadcasts, 1, 'the downloading status is pushed before the fetch begins');
    eq(sent[1].status.state, 'downloading', 'progress push');
    eq(sent[1].status.percent, 42, 'progress percent is rounded');
    eq(lastSent().status.state, 'downloaded', 'final push');

    /* ---- 5. a second click cannot stack up transfers --------------------- */
    status = await updater.downloadUpdate();
    eq(fake.calls.download, 1, 'downloadUpdate from a finished state is a no-op');
    eq(status.state, 'downloaded', 'state unchanged by the redundant call');

    // Same for re-checking while an update is waiting to install.
    const checksBefore = fake.calls.check;
    await updater.checkForUpdates();
    eq(fake.calls.check, checksBefore, 'no re-check while an update is pending install');

    /* ---- 6. install ------------------------------------------------------ */
    updater.installUpdate();
    eq(fake.calls.install.length, 1, 'install once downloaded');
    eq(
      JSON.stringify(fake.calls.install[0]),
      JSON.stringify([true, true]),
      'quitAndInstall(isSilent, isForceRunAfter): the NSIS wizard must stay hidden'
    );

    /* ---- 7. failures are statuses, never throws -------------------------- */
    // Clear the pending update first: state is event-driven, and the guard
    // asserted above would otherwise skip the check entirely.
    fake.emit('update-not-available', { version: '1.0.3' });
    sent.length = 0;
    fake.script.check = () => {
      fake.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    };
    status = await updater.checkForUpdates();
    eq(status.state, 'error', 'a failed check resolves to an error status');
    assert(/DISCONNECTED/.test(status.message), `error message kept: ${status.message}`);
    eq(fake.calls.download, 1, 'a failed check must not download');

    // And there is nothing to download from an error state.
    await updater.downloadUpdate();
    eq(fake.calls.download, 1, 'downloadUpdate without an offer is a no-op');

    eq(updater.getUpdateStatus().state, 'error', 'getUpdateStatus returns the cached status');

    /* ---- 8. the IPC surface the renderer talks to ------------------------ */
    const handlers = new Map();
    ipcMain.handle = (channel, fn) => handlers.set(channel, fn);
    registerUpdaterIpc();
    for (const channel of ['updater:status:get', 'updater:check', 'updater:download', 'updater:install']) {
      assert(handlers.has(channel), `IPC channel ${channel} is not registered`);
    }

    // Drive the new channel end to end: envelope in, downloadUpdate out.
    fake.script.check = () => fake.emit('update-available', { version: '1.0.4' });
    await handlers.get('updater:check')();
    const res = await handlers.get('updater:download')();
    assert(!res.error, `updater:download returned an error envelope: ${res.error}`);
    eq(res.data.state, 'downloaded', 'updater:download reports the reached status');
    eq(fake.calls.download, 2, 'updater:download reaches downloadUpdate');

    // Every updater channel the preload exposes must have a handler behind it;
    // a renderer button wired to a missing channel would only fail at runtime.
    const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'preload', 'index.ts'), 'utf8');
    const exposed = [...preloadSrc.matchAll(/invoke<[^>]*>\('(updater:[^']+)'\)/g)].map((m) => m[1]);
    assert(exposed.includes('updater:download'), 'preload does not expose updater:download');
    for (const channel of exposed) {
      assert(handlers.has(channel), `preload calls ${channel}, which nothing handles`);
    }

    /* ---- 9. the dev simulation ------------------------------------------ */
    // It has to produce the same statuses as the real feed, or looking at the
    // banner in dev tells you nothing about the app users get.
    const sim = require(path.join(buildDir, 'main', 'updater-sim.js'));

    Object.defineProperty(app, 'isPackaged', { get: () => false, configurable: true });
    delete process.env.npm_config_update_sim;
    const scenarioFor = (value) => {
      process.env.HB_UPDATE_SIM = value;
      return sim.requestedScenario();
    };
    eq(scenarioFor(''), null, 'no scenario means the real feed');
    eq(scenarioFor('0'), null, 'an off switch means the real feed');
    eq(scenarioFor('1'), 'available', 'a bare on switch offers an update');
    eq(scenarioFor('downloaded'), 'downloaded', 'named scenario');
    eq(scenarioFor('nonsense'), 'available', 'an unknown scenario still shows something');

    // PowerShell drops the `--` in `npm run dev -- --update-sim=x`, so npm keeps
    // the flag as a config of its own and only re-exports it here. Without this
    // fallback that command silently runs against the real feed.
    delete process.env.HB_UPDATE_SIM;
    process.env.npm_config_update_sim = 'downloaded';
    eq(sim.requestedScenario(), 'downloaded', 'npm-mangled flag is still honoured');
    process.env.npm_config_update_sim = 'true';
    eq(sim.requestedScenario(), 'available', 'a bare npm-mangled flag offers an update');
    delete process.env.npm_config_update_sim;
    eq(sim.requestedScenario(), null, 'nothing set means the real feed');

    // Faking an install in front of a real user is the one thing it must never do.
    Object.defineProperty(app, 'isPackaged', { get: () => true, configurable: true });
    eq(sim.requestedScenario(), null, 'simulation must be refused in a packaged build');
    delete process.env.HB_UPDATE_SIM;

    const simSent = [];
    const simUpdater = sim.createUpdateSim('available', (s) => simSent.push(s));
    const callsBefore = JSON.stringify(fake.calls);

    await simUpdater.check();
    eq(simSent[0].state, 'checking', 'simulated check starts by checking');
    eq(simSent[1].state, 'available', 'simulated check offers an update');
    assert(/^\d+\.\d+\.\d+$/.test(simSent[1].version), `simulated version looks real: ${simSent[1].version}`);

    simSent.length = 0;
    await simUpdater.download();
    eq(simSent[0].state, 'downloading', 'simulated download reports progress');
    eq(simSent[0].percent, 10, 'progress climbs from the 0% the caller broadcast');
    eq(lastOf(simSent).state, 'downloaded', 'simulated download ends installable');
    assert(simSent.length > 3, `progress should tick more than once: ${simSent.length} pushes`);

    simUpdater.install();
    eq(JSON.stringify(fake.calls), callsBefore, 'the simulation must never touch electron-updater');

    console.log(`UPDATER_OK checks=${fake.calls.check} downloads=${fake.calls.download} installs=${fake.calls.install.length}`);
    process.exitCode = 0;
  } catch (err) {
    console.error('UPDATER_FAIL', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
