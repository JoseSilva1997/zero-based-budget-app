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

    /* ---- the classifier ---- */
    {
      const { train } = imp('classifier.js');
      const GROCERIES = 11;
      const EATING_OUT = 12;
      const ex = (descriptorClean, label, more = {}) => ({
        descriptorClean, features: {}, accountId: 1, amountCents: 1500, label, ...more,
      });
      const model = train([
        ex('TESCO STORES', GROCERIES),
        ex('TESCO EXPRESS', GROCERIES),
        ex('SAINSBURYS S/MKTS', GROCERIES),
        ex('PIZZA EXPRESS', EATING_OUT),
        ex('NANDOS LONDON', EATING_OUT),
      ]);
      const guess = model.predict({ descriptorClean: 'TESCO STORES', features: {}, accountId: 1, amountCents: 1500 });
      eq(guess && guess.label, GROCERIES, 'a known shop is predicted as its category');
      assert(guess.confidence > 0.9 && guess.confidence <= 1, `and confidently (${guess && guess.confidence})`);

      const q = (descriptorClean, more = {}) => ({ descriptorClean, features: {}, accountId: 1, amountCents: 1500, ...more });
      eq(model.predict(q('DENTIST SMILES')), null, 'a descriptor like nothing seen has no prediction');
      eq(train([]).predict(q('TESCO STORES')), null, 'nothing learned, nothing predicted');

      // A partial resemblance is a weaker guess than an exact one.
      const loose = model.predict(q('TESCO PETROL'));
      eq(loose.label, GROCERIES, 'a shared word still points at the category');
      assert(loose.confidence < guess.confidence, 'but less confidently');

      // Transfers are a class of their own.
      const withTransfers = train([
        ex('TESCO STORES', GROCERIES),
        ex('ALEX EXAMPLE', 'transfer', { features: { type: 'Faster payment' } }),
        ex('SAM EXAMPLE', 'transfer', { features: { type: 'Faster payment' } }),
      ]);
      eq(withTransfers.predict(q('ALEX EXAMPLE', { features: { type: 'Faster payment' } })).label, 'transfer', 'a transfer is predicted as one');

      // The bank's own signals and the account tell apart one descriptor.
      const amazon = train([
        ex('AMAZON', GROCERIES, { features: { category: 'Groceries' } }),
        ex('AMAZON', GROCERIES, { features: { category: 'Groceries' } }),
        ex('AMAZON', EATING_OUT, { features: { category: 'Eating out' } }),
        ex('AMAZON', EATING_OUT, { features: { category: 'Eating out' } }),
      ]);
      eq(amazon.predict(q('AMAZON', { features: { category: 'Eating out' } })).label, EATING_OUT, "the bank's category breaks a tie");
      const byAccount = train([
        ex('PAYPAL', GROCERIES, { accountId: 1 }), ex('PAYPAL', GROCERIES, { accountId: 1 }),
        ex('PAYPAL', EATING_OUT, { accountId: 2 }), ex('PAYPAL', EATING_OUT, { accountId: 2 }),
      ]);
      eq(byAccount.predict(q('PAYPAL', { accountId: 2 })).label, EATING_OUT, 'so does the account');

      // Neighbours that disagree make an unsure guess.
      const split = train([ex('CORNER SHOP', GROCERIES), ex('CORNER SHOP', GROCERIES), ex('CORNER SHOP', EATING_OUT)]);
      const unsure = split.predict(q('CORNER SHOP'));
      eq(unsure.label, GROCERIES, 'the majority wins');
      assert(unsure.confidence < 0.7, `with a lower confidence (${unsure.confidence})`);
    }

    /* ---- the thresholds ---- */
    {
      const { HIGH_CONFIDENCE, LOW_CONFIDENCE } = imp('classifier.js');
      assert(0 < LOW_CONFIDENCE && LOW_CONFIDENCE < HIGH_CONFIDENCE && HIGH_CONFIDENCE <= 1, 'LOW is below HIGH, both within 0..1');
    }

    console.log('IMPORT_ENGINE_OK');
  } catch (err) {
    console.error('IMPORT_ENGINE_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    app.exit(code);
  }
});
