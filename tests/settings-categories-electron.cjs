/* ============================================================
   Settings > Categories renderer test.

   Mounts the real section inside the real store, in a hidden BrowserWindow,
   against a fake window.api, the way update-banner-electron.cjs mounts the
   banner. What it holds the section to:

     - categories are listed under their group with their usage, and the
       archived ones stay out of the way until asked for;
     - archiving and unarchiving go through the bridge and the list follows;
     - a merge states its impact BEFORE anything is written (the preview), and
       only the confirmation performs it, after which the month is reloaded.

   esbuild compiles the JSX (the same bundler the app ships with).

   Run with:  npx electron tests/settings-categories-electron.cjs
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const root = path.join(__dirname, '..');
const outDir = path.join(app.getPath('temp'), 'house-budget-categories-test');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const PAGE_SUITE = /* js */ `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './renderer/store.jsx';
import { CategoriesSection } from './renderer/Settings.jsx';

const results = [];
const check = (name, cond, msg) => results.push({ name, ok: !!cond, msg: cond ? '' : (msg || '') });
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

// A small household: "Going out I" sits under two groups, the real case a
// merge across groups exists for. Rainy day is archived.
let cats = [
  { id: 1, name: 'Groceries', groupId: 10, groupName: 'Bills', archived: false, lines: 9, entries: 143 },
  { id: 2, name: 'Going out I', groupId: 10, groupName: 'Bills', archived: false, lines: 1, entries: 1 },
  { id: 3, name: 'Going out I', groupId: 20, groupName: 'Fun', archived: false, lines: 4, entries: 12 },
  { id: 4, name: 'Rainy day', groupId: 30, groupName: 'Savings', archived: true, lines: 3, entries: 0 },
];
const calls = { getMonth: 0, archived: [], previews: [], merges: [] };
window.api = {
  bootstrap: async () => ({
    settings: { currency: '$', theme: 'obsidian', members: [], accounts: [] },
    monthList: [{ id: 1, month: '2026-10' }],
    activeMonth: '2026-10',
  }),
  getMonth: async () => { calls.getMonth += 1; return { month: '2026-10', incomes: [], groups: [] }; },
  categories: async () => cats.map((c) => ({ ...c })),
  categorySetArchived: async (id, archived) => {
    calls.archived.push([id, archived]);
    cats = cats.map((c) => (c.id === id ? { ...c, archived } : c));
    return { ok: true };
  },
  categoryPreviewMerge: async (fromId, intoId) => {
    calls.previews.push([fromId, intoId]);
    return { entries: 12, months: 4 };
  },
  categoryMerge: async (fromId, intoId) => {
    calls.merges.push([fromId, intoId]);
    cats = cats.filter((c) => c.id !== fromId);
    return { entries: 12, months: 4, backup: 'budget-2026-10-18T101500.sqlite' };
  },
};

const host = document.getElementById('root');
const text = () => host.textContent;
const byLabel = (label) => host.querySelector('[aria-label="' + label + '"]');
const buttonNamed = (label) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase().startsWith(label));
const press = async (el, name) => {
  check(name + ' is there to press', !!el, text());
  if (el) el.click();
  await settle();
};
const dialog = () => document.querySelector('[role="dialog"]');

window.__runTests = async () => {
  createRoot(host).render(createElement(StoreProvider, null, createElement(CategoriesSection)));
  await settle();

  /* ---- the list ------------------------------------------------------- */
  check('names each group', ['Bills', 'Fun'].every((g) => text().includes(g)), text());
  check('lists the categories', text().includes('Groceries') && text().includes('Going out I'), text());
  check('shows usage in months and entries', text().includes('9 months') && text().includes('143 entries'), text());
  check('says what archiving does', /hidden from/i.test(text()) && /history/i.test(text()), text());
  check('archived ones are put away at first', !text().includes('Rainy day'), text());

  await press(buttonNamed('show archived'), 'Show archived');
  check('and shown on request', text().includes('Rainy day'), text());
  check('marked archived', !!byLabel('Unarchive Rainy day'), text());

  /* ---- archive / unarchive -------------------------------------------- */
  await press(byLabel('Archive Groceries'), 'Archive Groceries');
  check('archive goes through the bridge', JSON.stringify(calls.archived[0]) === '[1,true]', JSON.stringify(calls.archived));
  check('the list follows', !!byLabel('Unarchive Groceries'), text());
  await press(byLabel('Unarchive Groceries'), 'Unarchive Groceries');
  check('unarchive goes through the bridge', JSON.stringify(calls.archived[1]) === '[1,false]', JSON.stringify(calls.archived));
  check('and the list follows again', !!byLabel('Archive Groceries'), text());

  /* ---- merge: impact first, then the write ---------------------------- */
  const monthLoadsBefore = calls.getMonth;
  await press(byLabel('Merge Going out I (Fun) into another category'), 'Merge Going out I');
  const select = dialog() && dialog().querySelector('select');
  check('the merge asks where to', !!select, dialog() ? dialog().textContent : 'no dialog');
  check('the target list leaves out the source', select && ![...select.options].some((o) => o.value === '3'));
  check('and offers the other group\\'s namesake', select && [...select.options].some((o) => o.value === '2'));
  if (select) {
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  await press(buttonNamed('review merge'), 'Review merge');
  check('previews before merging', JSON.stringify(calls.previews) === '[[3,1]]', JSON.stringify(calls.previews));
  check('nothing written yet', calls.merges.length === 0);
  const confirmText = dialog() ? dialog().textContent : '';
  check('states the impact', confirmText.includes('Moves 12 entries across 4 months into Groceries'), confirmText);
  check('says the source goes', confirmText.includes('Going out I is deleted'), confirmText);
  check('says a backup is taken and is the only undo', /backed up/i.test(confirmText) && /undo/i.test(confirmText), confirmText);

  await press(buttonNamed('merge categories'), 'Merge categories');
  check('merges what was previewed', JSON.stringify(calls.merges) === '[[3,1]]', JSON.stringify(calls.merges));
  check('closes the dialog', !dialog());
  check('the month view is reloaded', calls.getMonth > monthLoadsBefore, 'getMonth calls: ' + calls.getMonth);
  check('the merged category leaves the list', !byLabel('Merge Going out I (Fun) into another category'), text());

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
    assert(failed.length === 0, `${failed.length}/${results.length} category assertions failed`);
    assert(pageErrors.length === 0, `console errors in the renderer: ${pageErrors.join(' | ')}`);

    console.log(`SETTINGS_CATEGORIES_OK ${results.length} assertions`);
  } catch (err) {
    console.error('SETTINGS_CATEGORIES_FAIL', err && err.message ? err.message : err);
    code = 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(outDir, { recursive: true, force: true });
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});
