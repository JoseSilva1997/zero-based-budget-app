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

    const { detectPreset } = imp('presets', 'index.js');
    const fixture = (bank) => parseCsv(fs.readFileSync(path.join(__dirname, 'fixtures', 'import', `${bank}.csv`), 'utf8'));
    // The fields a test cares about, so one row reads on one line.
    const brief = (r) => [r.rowIndex, r.spentOn, r.postedOn, r.amountCents, r.direction, r.descriptorClean];

    /* ---- Monzo ---- */
    {
      const file = fixture('monzo');
      const monzo = detectPreset(file.header);
      eq(monzo && monzo.key, 'monzo', 'a Monzo header is detected');
      const rows = monzo.parse(file.records, { bankProduct: null });
      eq(
        rows.map(brief),
        [
          [2, '2026-01-01', '2026-01-01', 12212, 'debit', 'Alex Example'],
          [3, '2026-01-05', '2026-01-05', 500, 'credit', 'EXAMPLE SAM SI'],
          [4, '2026-01-06', '2026-01-06', 1240, 'debit', 'Tesco'],
        ],
        'Monzo: pot transfers are dropped; the signed Amount gives pence and direction; Name is the descriptor'
      );
      eq(rows[2].features, { category: 'Groceries', type: 'Card payment' }, 'Monzo: Category and Type are features');
      eq(rows[2].descriptorRaw, 'Tesco', 'Monzo: the raw descriptor is Name as written');
      eq(rows[2].raw['Transaction ID'], 'tx_0000AAAA5555555555555555', 'Monzo: the raw record is kept');
      eq(monzo.fileAccountIdentifier(file.records), null, 'Monzo: a statement names no account');

      // A row that can't be read comes back marked, never as a throw.
      const bad = monzo.parse(
        [
          { ...file.records[4], Amount: 'twelve' },
          { ...file.records[4], Date: '2026-01-06' },
          { ...file.records[4], Amount: '-12.405' },
        ],
        { bankProduct: null }
      );
      eq(
        bad.map((r) => r.parseError),
        ['Amount "twelve" is not an amount', 'Date "2026-01-06" is not a DD/MM/YYYY date', 'Amount "-12.405" is not an amount'],
        'Monzo: an unreadable amount or date is a parse error naming the field'
      );
      eq(monzo.parse([file.records[4]], { bankProduct: null })[0].parseError, undefined, 'a good row has no parse error');
    }

    /* ---- Lloyds ---- */
    {
      const file = fixture('lloyds');
      const lloyds = detectPreset(file.header);
      eq(lloyds && lloyds.key, 'lloyds', 'a Lloyds header is detected');
      const rows = lloyds.parse(file.records, { bankProduct: null });
      eq(
        rows.map(brief),
        [
          [0, '2026-09-28', '2026-09-28', 839, 'debit', 'WEBHOST'],
          [1, '2026-09-28', '2026-09-28', 4599, 'debit', 'SAM SAMPLE'],
          [2, '2026-09-28', '2026-09-28', 17593, 'credit', 'EXAMPLE A &'],
          [3, '2026-09-21', '2026-09-21', 5495, 'debit', 'EXAMPLE.CO.UK'],
        ],
        'Lloyds: Debit Amount is money out, Credit Amount money in; a trailing #<digits> is cleaned off'
      );
      eq(rows[0].descriptorRaw, 'WEBHOST#5550001234', 'Lloyds: the raw descriptor is kept whole');
      eq(rows[0].features, { type: 'DEB' }, 'Lloyds: the Transaction Type is a feature');
      eq(rows[0].accountIdentifier, '112233-12345678', 'Lloyds: the row names its account, sort code without the quote');
      eq(lloyds.fileAccountIdentifier(file.records), '112233-12345678', 'Lloyds: so does the file');

      const bad = lloyds.parse(
        [
          { ...file.records[0], 'Credit Amount': '1.00' },
          { ...file.records[0], 'Debit Amount': '' },
        ],
        { bankProduct: null }
      );
      eq(
        bad.map((r) => r.parseError),
        ['Both Debit Amount and Credit Amount are filled in', 'Neither Debit Amount nor Credit Amount is filled in'],
        'Lloyds: a row must have exactly one of the two amounts'
      );
      eq(
        brief(lloyds.parse([{ ...file.records[2], 'Credit Amount': '.06' }], { bankProduct: null })[0]).slice(3, 5),
        [6, 'credit'],
        'Lloyds: an amount under a pound may be written without the leading zero'
      );
    }

    /* ---- Revolut ---- */
    {
      const file = fixture('revolut');
      const revolut = detectPreset(file.header);
      eq(revolut && revolut.key, 'revolut', 'a Revolut header (after its BOM) is detected');
      eq(revolut.productsIn(file.records), ['Current', 'Savings'], 'Revolut: the products in the file, in order');
      eq(revolut.fileAccountIdentifier(file.records), null, 'Revolut: a statement names no account');

      const rows = revolut.parse(file.records, { bankProduct: 'Current' });
      eq(
        rows.map(brief),
        [
          [0, '2026-01-02', '2026-01-02', 2000, 'credit', 'Google Pay top-up by'],
          [1, '2026-01-02', '2026-01-03', 1750, 'debit', 'Cash withdrawal at Central Market'],
          [2, '2026-01-03', '2026-01-04', 883, 'debit', 'Cash withdrawal at Central Market'],
          [3, '2026-01-05', '2026-01-06', 121, 'debit', 'Little Bakery'],
          [5, '2026-01-07', '2026-01-07', 320, 'debit', 'Corner Cafe'],
        ],
        "Revolut: spent on the Started date, posted on the Completed one; the fee is part of the cost; another product's rows are dropped"
      );
      eq(rows.map((r) => !!r.notCompleted), [false, false, false, false, true], 'Revolut: a row not COMPLETED is marked');
      eq(rows[2].features, { type: 'ATM' }, 'Revolut: the Type is a feature');
      eq(rows[4].parseError, undefined, 'Revolut: a pending row without a Completed date is not an error');

      eq(
        revolut.parse(file.records, { bankProduct: null }).map((r) => r.rowIndex),
        [0, 1, 2, 3, 4, 5],
        'Revolut: with no product bound yet, every row is kept'
      );
    }

    /* ---- NatWest ---- */
    {
      const file = fixture('natwest');
      const natwest = detectPreset(file.header);
      eq(natwest && natwest.key, 'natwest', 'a NatWest header is detected');
      const rows = natwest.parse(file.records, { bankProduct: null });
      eq(
        rows.map(brief),
        [
          [0, '2026-09-28', '2026-09-29', 250, 'debit', 'DELI AB1'],
          [1, '2026-09-26', '2026-09-28', 1699, 'debit', 'SUPERDRUG STORES PLC'],
          [2, '2026-09-26', '2026-09-28', 2900, 'debit', 'SAINSBURYS S/MKTS'],
        ],
        'NatWest POS: spent on the card date in the description, posted on Date; the merchant segments are the descriptor'
      );
      eq(rows[1].descriptorRaw, '8765 26SEP26 CD , SUPERDRUG STORES , PLC , LITTLE TOWN GB', 'NatWest: the raw descriptor is kept whole');
      eq(rows[1].features, { type: 'POS' }, 'NatWest: the Type is a feature');
      eq(rows[1].accountIdentifier, '600000-11112222', 'NatWest: the row names its account');
      eq(natwest.fileAccountIdentifier(file.records), '600000-11112222', 'NatWest: so does the file');

      // Not every row carries a card date: Date is the fallback.
      const plain = natwest.parse(
        [{ ...file.records[0], Type: 'D/D', Description: 'EXAMPLE ENERGY LTD', Value: '45.00' }],
        { bankProduct: null }
      )[0];
      eq(brief(plain), [0, '2026-09-29', '2026-09-29', 4500, 'credit', 'EXAMPLE ENERGY LTD'], 'NatWest: without a card date, spent on Date');

      // The card payments' other shapes, seen on real statements (invented here).
      const card = (description) => {
        const r = natwest.parse([{ ...file.records[0], Description: description }], { bankProduct: null })[0];
        return [r.spentOn, r.descriptorClean];
      };
      eq(card('1234 03SEP26 , EXAMPLE STREAMING , LONDON GB'), ['2026-09-03', 'EXAMPLE STREAMING'], 'NatWest: an online card payment has no CD marker');
      eq(card('1234 03SEP26 C , EXAMPLE CAFE , TOWN GB'), ['2026-09-03', 'EXAMPLE CAFE'], 'NatWest: the marker may be C');
      eq(card('1234 03SEP26 D , EXAMPLE SHOP , TOWN GB'), ['2026-09-03', 'EXAMPLE SHOP'], 'NatWest: or D');
      eq(
        card('1234 03SEP26 CD , EXAMPLE BAR , SOMETOWN , REGION PT , EUR 6.00, VRATE 1.1627'),
        ['2026-09-03', 'EXAMPLE BAR SOMETOWN'],
        'NatWest: a payment abroad ends with the foreign amount and rate, which are not the merchant'
      );
    }

    /* ---- generic descriptor cleaning, for every bank ---- */
    {
      const { cleanDescriptor } = imp('clean.js');
      eq(cleanDescriptor('  Personal   Pot '), 'Personal Pot', 'whitespace is trimmed and collapsed');
      eq(cleanDescriptor('Example Pay top-up by *1234'), 'Example Pay top-up by', 'a "*1234" card fragment goes');
      eq(cleanDescriptor('EXAMPLEPAY**4321*'), 'EXAMPLEPAY', 'so does a "**4321*" one');
      eq(cleanDescriptor('RIDES   *TRIP'), 'RIDES TRIP', 'a * between a processor and a merchant is a space');
      eq(cleanDescriptor('ZPAY_*CORNER SHOP'), 'ZPAY CORNER SHOP', 'and _* too');
      eq(cleanDescriptor('EXAMPLE UK*'), 'EXAMPLE UK', 'a trailing * goes');
      eq(cleanDescriptor('Corner Cafe'), 'Corner Cafe', "the bank's casing is kept");
      eq(cleanDescriptor('AB123456C EXAMPLE DEPT'), 'EXAMPLE DEPT', 'a reference token (letters and many digits) goes');
      eq(cleanDescriptor('EXAMPLE SHOP X12YZ3AB4'), 'EXAMPLE SHOP', 'wherever it is in the descriptor');
      eq(cleanDescriptor('Transfer 1234567890'), 'Transfer', 'so does a long run of digits');
      eq(cleanDescriptor('101 CORNER SHOP AB1'), '101 CORNER SHOP AB1', 'short numbers in a name stay');
    }

    /* ---- detection is an exact match on the set of names ---- */
    {
      const header = fixture('lloyds').header;
      eq(detectPreset([...header].reverse().map((h) => ` ${h.toUpperCase()} `)).key, 'lloyds', 'order, case and padding do not matter');
      eq(detectPreset([...header, 'Notes']), null, 'an extra column is not a match');
      eq(detectPreset(header.slice(1)), null, 'a missing column is not a match');
      eq(detectPreset(['Date', 'Amount']), null, 'an unknown statement matches nothing');
    }

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
