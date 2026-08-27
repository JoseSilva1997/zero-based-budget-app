/* ============================================================
   Guards the one invariant the Shortcuts section in Settings relies on:
   what the menu binds is exactly what shortcutDocs() documents.

   Builds the real application menu, walks it for every item carrying an
   accelerator, and compares that set against shortcutDocs() in both
   directions. Add an accelerator to the menu without documenting it (or
   document one that is not bound) and this fails.

   Requires a prior `npm run build` (loads build/main/menu.js).
   Run with:  npx electron tests/menu-electron.cjs
   ============================================================ */
const { app, Menu } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

/** Every accelerator in the menu tree, as "Label\tAccelerator". */
function walkAccelerators(items, out = []) {
  for (const it of items) {
    if (it.accelerator && !it.role) out.push({ label: it.label, accelerator: it.accelerator });
    if (it.submenu && it.submenu.items) walkAccelerators(it.submenu.items, out);
  }
  return out;
}

app.whenReady().then(() => {
  try {
    const m = (...p) => require(path.join(__dirname, '..', 'build', 'main', ...p));
    const { buildAppMenu, shortcutDocs } = m('menu.js');

    buildAppMenu();
    const menu = Menu.getApplicationMenu();
    assert(menu, 'no application menu was built');

    const bound = walkAccelerators(menu.items);
    const docs = shortcutDocs();

    assert(docs.length > 0, 'shortcutDocs() returned nothing');

    // Every documented shortcut is really bound, with the same label and keys.
    const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl';
    for (const d of docs) {
      const hit = bound.find((b) => b.label === d.label);
      assert(hit, `documented shortcut "${d.label}" is not in the menu`);
      const shown = hit.accelerator
        .replace('CmdOrCtrl', mod)
        .replace('Left', '←')
        .replace('Right', '→')
        .split('+');
      eq(d.keys.join('+'), shown.join('+'), `keys for "${d.label}" disagree with the menu`);
      assert(d.group && d.group.length > 0, `documented shortcut "${d.label}" has no group`);
    }

    // ...and every bound accelerator is documented.
    for (const b of bound) {
      assert(
        docs.some((d) => d.label === b.label),
        `menu accelerator "${b.label}" (${b.accelerator}) is not documented in shortcutDocs()`
      );
    }

    eq(bound.length, docs.length, 'menu accelerator count and documented count differ');

    // The renderer draws chips straight from `keys`, so they must be split.
    for (const d of docs) {
      assert(Array.isArray(d.keys) && d.keys.length > 0, `"${d.label}" has no keys`);
      for (const k of d.keys) assert(!k.includes('+'), `"${d.label}" key "${k}" was not split`);
      assert(!d.keys.includes('CmdOrCtrl'), `"${d.label}" still carries the raw CmdOrCtrl token`);
    }

    console.log(`MENU_OK accelerators=${bound.length} documented=${docs.length} groups=${[...new Set(docs.map((d) => d.group))].join(',')}`);
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(0);
  } catch (err) {
    console.error('MENU_FAIL', err && err.message ? err.message : err);
    app.exit(1);
  }
});
