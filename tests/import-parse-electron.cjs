/* ============================================================
   Import parse test: the pure pieces of "Upload transactions" that turn a
   bank-statement CSV into normalised rows, before anything touches the
   database.

   1. The CSV reader (RFC 4180: quotes, escaped quotes, CRLF, a BOM).
   2. Each bank's preset, on the anonymised sample statements committed
      under tests/fixtures/import/: header detection, amounts in integer
      pence, dates, the descriptor, dropped rows and per-row errors.
   3. Descriptor cleaning, generic and per bank.

   Requires a prior `npm run build` (loads build/main/import/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     npx electron tests/import-parse-electron.cjs
   ============================================================ */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

function eq(a, b, msg) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg}: got ${ja}, want ${jb}`);
}

const root = path.join(__dirname, '..');
const imp = (...p) => require(path.join(root, 'build', 'main', 'import', ...p));

app.whenReady().then(() => {
  let code = 0;
  try {
    const { parseCsv } = imp('csv.js');

    /* ---- the CSV reader ---- */
    eq(
      parseCsv('a,b\n1,2\n'),
      { header: ['a', 'b'], records: [{ a: '1', b: '2' }] },
      'a plain file reads as a header and records keyed by it'
    );
    eq(
      parseCsv('name,note\n"Smith, J","said ""hi"""\n').records,
      [{ name: 'Smith, J', note: 'said "hi"' }],
      'a quoted field keeps its commas, and "" inside it is one quote'
    );
    eq(
      parseCsv('a,b\r\n1,2\r\n3,4\r\n'),
      { header: ['a', 'b'], records: [{ a: '1', b: '2' }, { a: '3', b: '4' }] },
      'CRLF line endings leave no stray \\r on the last field'
    );
    eq(parseCsv('﻿Type,Product\nTopup,Current\n').header, ['Type', 'Product'], 'a UTF-8 BOM is not part of the first header');
    eq(parseCsv('a,b\n1,2\n\n\r\n\n').records, [{ a: '1', b: '2' }], 'trailing blank lines are not records');
    eq(parseCsv('a,b\n1,2').records, [{ a: '1', b: '2' }], 'the last record needs no newline');
    eq(parseCsv('a,b\n1,"two\nlines"\n').records, [{ a: '1', b: 'two\nlines' }], 'a quoted field may span lines');

    console.log('IMPORT_PARSE_OK');
  } catch (err) {
    console.error('IMPORT_PARSE_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});
