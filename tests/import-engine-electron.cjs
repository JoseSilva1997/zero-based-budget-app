/* ============================================================
   Import engine test: the pure pieces of "Upload transactions" between the
   parsed rows and the database.

   1. Fingerprints: the stable identity a statement row keeps across uploads,
      so a re-upload is recognised as already imported.
   2. The classifier: TF-IDF over the descriptor and the bank's signals, then
      kNN, predicting a category or a transfer, with a confidence. Trained on
      invented descriptors here, never on anyone's statements.
   3. Labels: what the review says about a row, and what that row is
      effectively (category, name, kind, ticked) from its labels and your
      decisions.

   Requires a prior `npm run build` (loads build/main/import/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     npx electron tests/import-engine-electron.cjs
   ============================================================ */
const { app } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg}: got ${ja}, want ${jb}`);
}

const root = path.join(__dirname, '..');
const imp = (...p) => require(path.join(root, 'build', 'main', 'import', ...p));

/** A parsed row with only what a test cares about filled in. */
function row(fields) {
  return {
    rowIndex: 0,
    postedOn: '2026-09-02',
    spentOn: '2026-09-02',
    amountCents: 1250,
    direction: 'debit',
    descriptorRaw: 'TESCO STORES 2656',
    descriptorClean: 'TESCO STORES',
    features: {},
    raw: {},
    ...fields,
  };
}

app.whenReady().then(() => {
  let code = 0;
  try {
    /* ---- fingerprints ---- */
    {
      const { fingerprintRows } = imp('fingerprint.js');
      const coffee = row({ descriptorRaw: 'CAFE NERO', amountCents: 320 });
      const shop = row({ descriptorRaw: 'TESCO STORES 2656' });
      const [a1, a2] = fingerprintRows(7, [coffee, shop]);
      const [b1] = fingerprintRows(7, [{ ...coffee, rowIndex: 40, descriptorClean: 'renamed' }]);
      eq(b1, a1, 'the same row in another file has the same fingerprint, wherever it sits');
      assert(a1 !== a2, 'different rows differ');
      assert(typeof a1 === 'string' && a1.length >= 32, 'a fingerprint is a hash string');

      // Two identical coffees on one day are two rows, told apart by order.
      const [c1, c2] = fingerprintRows(7, [coffee, coffee]);
      assert(c1 !== c2, 'identical rows in one file get different fingerprints');
      eq(c1, a1, 'the first of them is the lone coffee');
      eq(fingerprintRows(7, [shop, coffee, coffee])[2], c2, 'the second keeps its number when other rows come between');

      const changed = (f) => fingerprintRows(7, [{ ...coffee, ...f }])[0] !== a1;
      assert(fingerprintRows(8, [coffee])[0] !== a1, 'another account differs');
      assert(changed({ spentOn: '2026-09-03' }), 'another date differs');
      assert(changed({ amountCents: 321 }), 'another amount differs');
      assert(changed({ direction: 'credit' }), 'another direction differs');
      assert(changed({ descriptorRaw: 'CAFE NERO 2' }), 'another raw descriptor differs');
    }

    console.log('IMPORT_ENGINE_OK');
  } catch (err) {
    console.error('IMPORT_ENGINE_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    app.exit(code);
  }
});
