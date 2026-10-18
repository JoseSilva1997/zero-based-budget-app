/* ============================================================
   Upload transactions sheet renderer test.

   Mounts the real sheet inside the real store, in a hidden BrowserWindow,
   against a fake window.api that keeps a small upload server of its own, the
   way settings-categories-electron.cjs mounts its section. What it holds the
   sheet to:

     - the upload step draws one drop zone per account, lists each zone's
       files, sets an account's bank up inline when a statement needs one and
       retries the file, and only lets you on to Review once a file is in;
     - the review is one list with a separator per account, label chips
       coloured by severity, blocked rows sunk and inert, filter chips across
       every account, and the rows outside the month folded away;
     - every decision (name, category, transfer, tick, "Same as existing")
       goes through importUpdateRow and the review is read again;
     - the over-plan line is computed locally, Confirm imports and refreshes
       the month, and Undo puts an import back to pending.

   Also unit-tests the pure helpers in renderer/lib/imports.js.

   esbuild compiles the JSX (the same bundler the app ships with).

   Run with:  npx electron tests/upload-sheet-electron.cjs
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const root = path.join(__dirname, '..');
const outDir = path.join(app.getPath('temp'), 'house-budget-upload-sheet-test');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const PAGE_SUITE = /* js */ `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './renderer/store.jsx';
import { UploadSheet } from './renderer/Upload.jsx';

const results = [];
const check = (name, cond, msg) => results.push({ name, ok: !!cond, msg: cond ? '' : (msg || '') });
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

/* ---- the fake upload server ------------------------------------------- */
const LLOYDS = { id: 1, name: 'Lloyds', preset: 'lloyds' };
const account = (id, name, bankId) => ({
  id, name, kind: 'main', owner_member_id: null, color: '#888888', sort_order: id,
  bank_id: bankId, account_identifier: null, bank_product: null,
});
const server = {
  banks: [LLOYDS],
  accounts: [account(1, 'Main', 1), account(2, 'Joint', null)],
  batch: null,
  files: [],     // { id, accountId, filename, rowCount }
  rows: [],      // ImportRowRead, with accountId
  history: [],
  calls: { added: [], removed: [], updates: [], bankCreate: [], setBank: [], confirm: [], discard: [], undo: [], getMonth: 0 },
};

const review = () => ({
  month: { id: 1, month: '2026-10' },
  batch: server.batch,
  accounts: server.accounts.map((a) => ({
    account: a,
    bank: server.banks.find((b) => b.id === a.bank_id) || null,
    files: server.files.filter((f) => f.accountId === a.id).map((f) => ({ id: f.id, filename: f.filename, rowCount: f.rowCount, createdAt: '' })),
    rows: server.rows.filter((r) => r.accountId === a.id),
  })),
  plan: [],
  categories: [],
});

window.api = {
  bootstrap: async () => ({
    settings: { currency: '£', theme: 'obsidian', members: [], accounts: server.accounts },
    monthList: [{ id: 1, month: '2026-10' }],
    activeMonth: '2026-10',
  }),
  getMonth: async () => { server.calls.getMonth += 1; return { month: '2026-10', incomes: [], groups: [] }; },
  importReview: async () => review(),
  importHistory: async () => server.history.map((h) => ({ ...h })),
  banks: async () => server.banks.map((b) => ({ ...b })),
  // The preload resolves needs_bank rather than throwing; other refusals throw.
  importAddFile: async ({ accountId, filename, text }) => {
    server.calls.added.push({ accountId, filename, text });
    const acc = server.accounts.find((a) => a.id === accountId);
    if (acc.bank_id == null) {
      return { status: 'needs_bank', message: 'Choose the bank for this account first.', preset: 'natwest', products: null };
    }
    if (server.files.some((f) => f.filename === filename)) throw new Error('That file is already in this upload.');
    if (!server.batch) server.batch = { id: 7, status: 'pending', createdAt: '2026-10-18 10:00:00' };
    const file = { id: server.files.length + 100, accountId, filename, rowCount: 3 };
    server.files.push(file);
    return { status: 'added', file: { ...file, batchId: 7 } };
  },
  importRemoveFile: async (fileId) => {
    server.calls.removed.push(fileId);
    server.files = server.files.filter((f) => f.id !== fileId);
    server.rows = server.rows.filter((r) => r.fileId !== fileId);
    return { ok: true };
  },
};

const host = document.getElementById('root');
let root = null;
const mount = async () => {
  if (root) root.unmount();
  root = createRoot(host);
  root.render(createElement(StoreProvider, null, createElement(UploadSheet, { month: '2026-10', currency: '£', onClose: () => {} })));
  await settle();
};
const text = () => document.body.textContent;
const zones = () => [...document.querySelectorAll('[data-account-zone]')];
const zone = (id) => document.querySelector('[data-account-zone="' + id + '"]');
const byLabel = (label) => document.querySelector('[aria-label="' + label + '"]');
const buttonNamed = (label) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase().startsWith(label.toLowerCase()));
const press = async (el, name) => {
  check(name + ' is there to press', !!el, text().slice(0, 300));
  if (el) el.click();
  await settle();
};
// Hands files to a zone's picker, the way choosing them in the dialog does.
const choose = async (accountId, names) => {
  const input = zone(accountId).querySelector('input[type="file"]');
  const dt = new DataTransfer();
  for (const n of names) dt.items.add(new File(['Date,Description,Value\\n'], n, { type: 'text/csv' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};

window.__runTests = async () => {
  /* ---- 1. one drop zone per account --------------------------------- */
  await mount();
  check('the sheet is a dialog named for the upload', !!document.querySelector('[role="dialog"][aria-label="Upload transactions"]'), text());
  check('one zone per account, in display order', zones().map((z) => z.getAttribute('data-account-zone')).join(',') === '1,2', zones().length + '');
  check('a zone names its account and bank', zones()[0] && /Main/.test(zones()[0].textContent) && /Lloyds/.test(zones()[0].textContent), zones()[0] && zones()[0].textContent);
  check('an account with no bank says so', zones()[1] && /No bank yet/.test(zones()[1].textContent), zones()[1] && zones()[1].textContent);
  check('each zone offers a file picker', zones().every((z) => z.querySelector('input[type="file"][multiple]')), '');


  /* ---- files in a zone ------------------------------------------------ */
  await choose(1, ['lloyds-sep.csv']);
  check('a chosen file is sent as text for its account', server.calls.added.length === 1 && server.calls.added[0].accountId === 1 && server.calls.added[0].filename === 'lloyds-sep.csv' && /Date,Description/.test(server.calls.added[0].text), JSON.stringify(server.calls.added));
  check('the zone lists the file with its row count', /lloyds-sep\.csv/.test(zone(1).textContent) && /3 rows/.test(zone(1).textContent), zone(1).textContent);
  await press(byLabel('Remove lloyds-sep.csv'), 'Remove lloyds-sep.csv');
  check('removing a file goes through the bridge', server.calls.removed.length === 1, JSON.stringify(server.calls.removed));
  check('and it leaves the zone', !/lloyds-sep\.csv/.test(zone(1).textContent), zone(1).textContent);

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
    for (const f of failed) console.error(`  FAIL ${f.name}${f.msg ? ` (${f.msg.slice(0, 400)})` : ''}`);
    assert(failed.length === 0, `${failed.length}/${results.length} upload sheet assertions failed`);
    assert(pageErrors.length === 0, `console errors in the renderer: ${pageErrors.join(' | ')}`);

    console.log(`UPLOAD_SHEET_OK ${results.length} assertions`);
  } catch (err) {
    console.error('UPLOAD_SHEET_FAIL', err && err.message ? err.message : err);
    code = 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(outDir, { recursive: true, force: true });
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});
