/* ============================================================
   Store month-cache test.

   Groups and categories are shared by every month, so an edit made while one
   month is open (a rename, a collapse, a move, a group reorder) changes how
   every other month reads. The store caches month trees it has visited; this
   holds it to never showing a month from a cache an edit has made stale.

   Mounts the real store against a fake window.api in a hidden BrowserWindow,
   like settings-categories-electron.cjs.

   Run with:  npx electron tests/store-months-electron.cjs
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const root = path.join(__dirname, '..');
const outDir = path.join(app.getPath('temp'), 'house-budget-store-months-test');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const PAGE_SUITE = /* js */ `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useStore } from './renderer/store.jsx';

const results = [];
const check = (name, cond, msg) => results.push({ name, ok: !!cond, msg: cond ? '' : (msg || '') });
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

// One shared group, "Bills", with a line in both months: the server side of
// the fake keeps ONE name for it, as the database now does.
const server = { groupName: 'Bills', collapsed: false };
const tree = (id, month) => ({
  id, month, incomes: [],
  groups: [{ id: 10, name: server.groupName, isSavings: false, collapsed: server.collapsed, kind: 'spend',
             items: [{ id: id * 100, category_id: 7, name: 'Rent', allocated: 1000, account: null, actuals: [] }] }],
});
window.api = {
  bootstrap: async () => ({
    settings: { currency: '$', theme: 'obsidian', members: [], accounts: [] },
    monthList: [{ id: 1, month: '2026-09' }, { id: 2, month: '2026-10' }],
    activeMonth: '2026-10',
  }),
  monthSetActive: async () => ({ ok: true }),
  getMonth: async (id) => tree(id, id === 1 ? '2026-09' : '2026-10'),
  groupUpdate: async (id, patch) => {
    if ('name' in patch) server.groupName = patch.name;
    if ('collapsed' in patch) server.collapsed = patch.collapsed;
    return { ok: true };
  },
};

let store = null;
function Probe() { store = useStore(); return null; }
const group = (key) => store.state.months[key] && store.state.months[key].groups[0];

window.__runTests = async () => {
  createRoot(document.getElementById('root')).render(createElement(StoreProvider, null, createElement(Probe)));
  await settle();

  // Visit September, so it is cached, then come back to October.
  await store.dispatch({ type: 'setActive', id: '2026-09' });
  await store.dispatch({ type: 'setActive', id: '2026-10' });
  await settle();

  await store.dispatch({ type: 'renameGroup', month: '2026-10', groupId: 10, name: 'Household' });
  await settle();
  await store.dispatch({ type: 'setActive', id: '2026-09' });
  await settle();
  check('a group renamed in October reads renamed in September', group('2026-09') && group('2026-09').name === 'Household',
    JSON.stringify(group('2026-09')) + ' cached: ' + Object.keys(store.state.months) + ' active: ' + store.state.activeMonth);

  await store.dispatch({ type: 'toggleCollapse', month: '2026-09', groupId: 10 });
  await settle();
  await store.dispatch({ type: 'setActive', id: '2026-10' });
  await settle();
  check('a collapse in September shows in October', group('2026-10') && group('2026-10').collapsed === true,
    JSON.stringify(group('2026-10')));

  // And toggling it from October now opens it, rather than "collapsing" it again.
  await store.dispatch({ type: 'toggleCollapse', month: '2026-10', groupId: 10 });
  await settle();
  check('a toggle reads the current state, not a stale one', server.collapsed === false, String(server.collapsed));

  return results;
};
`;

app.whenReady().then(async () => {
  let win = null;
  let code = 0;
  try {
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
    assert(failed.length === 0, `${failed.length}/${results.length} store assertions failed`);
    assert(pageErrors.length === 0, `console errors in the renderer: ${pageErrors.join(' | ')}`);

    console.log(`STORE_MONTHS_OK ${results.length} assertions`);
  } catch (err) {
    console.error('STORE_MONTHS_FAIL', err && err.message ? err.message : err);
    code = 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(outDir, { recursive: true, force: true });
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});
