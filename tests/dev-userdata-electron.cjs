/* ============================================================
   Guards the dev data folder: an unpackaged launch (npm start, npm run dev)
   must never open the installed app's database, since a newer schema would
   migrate it past what the installed release can read.

   Tests the pure decision only (devUserDataPath), so nothing here touches the
   real appData folder.

   Requires a prior `npm run build` (loads build/main/devUserData.js).
   Run with:  npx electron tests/dev-userdata-electron.cjs
   ============================================================ */
const { app } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

app.whenReady().then(() => {
  try {
    const { devUserDataPath, DEV_APP_NAME } = require(path.join(__dirname, '..', 'build', 'main', 'devUserData.js'));
    const appData = path.join(path.sep, 'sandbox', 'appData');
    const base = { isPackaged: false, hasUserDataDirSwitch: false, realData: undefined, appData };

    eq(DEV_APP_NAME, 'House Budget Dev', 'dev folder name');
    eq(devUserDataPath(base), path.join(appData, 'House Budget Dev'),
      'an unpackaged launch gets its own folder');
    eq(devUserDataPath({ ...base, isPackaged: true }), null,
      'a packaged build keeps its own userData');
    eq(devUserDataPath({ ...base, hasUserDataDirSwitch: true }), null,
      'an explicit --user-data-dir (the screenshot skill) wins');
    eq(devUserDataPath({ ...base, realData: '1' }), null,
      'HB_REAL_DATA=1 opens the real data on purpose');
    eq(devUserDataPath({ ...base, realData: '' }), path.join(appData, 'House Budget Dev'),
      'an empty HB_REAL_DATA does not count');
    eq(devUserDataPath({ ...base, realData: '0' }), path.join(appData, 'House Budget Dev'),
      'HB_REAL_DATA=0 does not count');

    console.log('dev userData: OK');
    app.exit(0);
  } catch (err) {
    console.error('dev userData: FAILED\n', err);
    app.exit(1);
  }
});
