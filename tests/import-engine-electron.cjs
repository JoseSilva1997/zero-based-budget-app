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

    /* ---- labels and what a row effectively is ---- */
    {
      const { assessRow, LABELS } = imp('labels.js');
      const { HIGH_CONFIDENCE, LOW_CONFIDENCE } = imp('classifier.js');
      const GROC = 11;
      const sure = { label: GROC, confidence: 0.95 };
      const facts = (more = {}) => ({
        monthKey: '2026-09',
        spentOn: '2026-09-04',
        direction: 'debit',
        descriptorClean: 'TESCO STORES',
        parseError: null,
        notCompleted: false,
        alreadyImported: false,
        duplicates: 0,
        prediction: sure,
        inMonth: (id) => id === GROC,
        stored: { categoryId: null, name: null, kind: null, included: null, linkedEntryId: null },
        ...more,
      });
      const keys = (r) => r.labels.map((l) => l.key);
      const stored = (s) => ({ stored: { categoryId: null, name: null, kind: null, included: null, linkedEntryId: null, ...s } });

      // A confident prediction in a planned category is simply ticked.
      const plain = assessRow(facts());
      eq(keys(plain), ['ok'], 'a confident, planned, in-month spend is ok');
      eq(plain.labels[0].severity, 'none', 'ok is no chip');
      eq([plain.categoryId, plain.name, plain.kind, plain.included], [GROC, 'TESCO STORES', 'spend', true], 'and ticked with the prediction and the cleaned name');

      // Your decisions win over the prediction.
      const mine = assessRow(facts(stored({ categoryId: 12, name: 'Weekly shop', included: 0 })));
      eq([mine.categoryId, mine.name, mine.included], [12, 'Weekly shop', false], 'stored category, name and tick win');
      eq(keys(mine), ['not_in_month'], 'a chosen category with no plan line this month says so');

      // Confidence bands.
      const unsure = assessRow(facts({ prediction: { label: GROC, confidence: (HIGH_CONFIDENCE + LOW_CONFIDENCE) / 2 } }));
      eq([keys(unsure), unsure.categoryId, unsure.included], [['low_confidence'], GROC, false], 'a middling guess is pre-filled, flagged and unticked');
      eq(unsure.labels[0], { key: 'low_confidence', severity: 'warn', text: 'Check category' }, 'with its chip');
      const wild = assessRow(facts({ prediction: { label: GROC, confidence: LOW_CONFIDENCE / 2 } }));
      eq([keys(wild), wild.categoryId, wild.included], [['uncategorised'], null, false], 'a wild guess is no category');
      // A first import is mostly rows like this, so the chip is a warning
      // (Lantern Amber), not a refusal; the tick still waits for a category.
      eq(wild.labels[0], { key: 'uncategorised', severity: 'warn', text: 'No category' }, 'with an amber chip');
      eq(assessRow(facts({ prediction: null, duplicates: 1, ...stored({ included: 1 }) })).included, false, 'and no tick counts until a category is picked');
      eq(assessRow(facts({ prediction: null })).labels[0].text, 'No category', 'nor is no guess');
      const picked = assessRow(facts({ prediction: null, ...stored({ categoryId: GROC }) }));
      eq([keys(picked), picked.included], [['ok'], true], 'picking a category makes it ok and ticked');
      const forced = assessRow(facts({ prediction: null, ...stored({ included: 1 }) }));
      eq(forced.included, false, 'a tick without a category does not count');

      // Transfers.
      const transfer = assessRow(facts({ prediction: { label: 'transfer', confidence: 0.9 } }));
      eq([keys(transfer), transfer.kind, transfer.included], [['transfer'], 'transfer', false], 'a predicted transfer is one, unticked');
      eq(assessRow(facts({ prediction: { label: 'transfer', confidence: 0.9 }, ...stored({ included: 1 }) })).included, false, 'and stays out while it is a transfer');
      const back = assessRow(facts({ prediction: { label: 'transfer', confidence: 0.9 }, ...stored({ kind: 'spend', categoryId: GROC, included: 1 }) }));
      eq([keys(back), back.kind, back.included], [['ok'], 'spend', true], 'switched back to spend, it can be ticked');
      const marked = assessRow(facts(stored({ kind: 'transfer' })));
      eq([keys(marked), marked.kind], [['transfer'], 'transfer'], 'you can mark a spend a transfer');

      // Out of month and duplicates warn and start unticked; a tick overrides.
      const early = assessRow(facts({ spentOn: '2026-08-30' }));
      eq([keys(early), early.included], [['out_of_month'], false], 'outside the month is a warning');
      eq(assessRow(facts({ spentOn: '2026-08-30', ...stored({ included: 1 }) })).included, true, 'that you can tick through');
      const dup = assessRow(facts({ duplicates: 2 }));
      eq([keys(dup), dup.labels[0].text, dup.included], [['possible_duplicate'], 'Possible duplicate', false], 'a possible duplicate starts unticked');

      // Linked to an existing entry: never imported again.
      eq(assessRow(facts({ duplicates: 1, ...stored({ linkedEntryId: 5, included: 1 }) })).included, false, 'a linked row is never ticked');

      // Hard blocks can't be ticked, whatever is stored, and say nothing else.
      for (const [more, key, text] of [
        [{ alreadyImported: true }, 'already_imported', 'Already imported'],
        [{ parseError: 'Value "x" is not an amount', direction: null }, 'parse_error', "Couldn't read"],
        [{ notCompleted: true }, 'not_completed', 'Not completed'],
      ]) {
        const r = assessRow(facts({ ...more, duplicates: 1, ...stored({ included: 1 }) }));
        eq([keys(r), r.included], [[key], false], `${key} blocks the row`);
        eq([r.labels[0].severity, r.labels[0].text], ['block', text], `${key}'s chip`);
      }

      // Several labels at once.
      eq(keys(assessRow(facts({ spentOn: '2026-10-01', duplicates: 1, prediction: { label: 13, confidence: 0.4 } }))).sort(),
        ['low_confidence', 'not_in_month', 'out_of_month', 'possible_duplicate'], 'a row can carry several labels');

      // Teaching without importing: an unticked spend whose category you
      // picked trains the classifier on confirm, though it writes no entry.
      const teaches = (more) => assessRow(facts(more)).teaches;
      eq(teaches(stored({ categoryId: GROC, included: 0 })), true, 'a category you picked, unticked, teaches');
      eq(teaches({ prediction: null, ...stored({ categoryId: GROC, included: 0 }) }), true, 'whatever the row started as');
      eq(teaches(stored({ categoryId: 12, included: 0 })), true, 'including a corrected guess');
      eq(teaches({ duplicates: 1, ...stored({ categoryId: GROC }) }), true, 'a possible duplicate left unticked teaches');
      eq(teaches({ spentOn: '2026-08-30', ...stored({ categoryId: GROC }) }), true, 'and so does a row outside the month');
      eq(teaches(stored({ categoryId: GROC })), false, 'a ticked row is imported, not only taught');
      eq(teaches(stored({ included: 0 })), false, 'an unticked guess you never chose does not teach');
      eq(teaches({ prediction: null, ...stored({ included: 0 }) }), false, 'nor does a row with no category');
      eq(teaches(stored({ categoryId: GROC, kind: 'transfer' })), false, 'a transfer teaches transfer, not its category');
      eq(teaches({ prediction: { label: 'transfer', confidence: 0.9 }, ...stored({ categoryId: GROC }) }), false, 'nor does a predicted transfer');
      eq(teaches({ duplicates: 1, ...stored({ categoryId: GROC, linkedEntryId: 5 }) }), false, 'a matched row teaches through its entry');
      for (const more of [{ alreadyImported: true }, { notCompleted: true }]) {
        eq(teaches({ ...more, ...stored({ categoryId: GROC, included: 0 }) }), false, `a blocked row does not teach (${Object.keys(more)[0]})`);
      }

      // Money in: a refund, money back, or a plain "Money in".
      const credit = (more = {}) => assessRow(facts({ direction: 'credit', descriptorClean: 'HM ONLINE', ...more }));
      const inOut = (r) => [keys(r), r.included, r.writesAs, r.categoryId];
      eq(inOut(credit({ refundTarget: 'same_month' })), [['refund'], true, 'refund', null], "a refund of this month's purchase is ticked, written as a refund");
      eq(inOut(credit({ refundTarget: 'earlier_month' })), [['money_back'], true, 'money_back', null], "of an earlier month's, as money back");
      eq(inOut(credit({ refundTarget: null })), [['credit'], false, 'money_back', null], 'money in with no purchase starts unticked');
      eq(credit({ refundTarget: null }).labels[0], { key: 'credit', severity: 'warn', text: 'Money in' }, 'with an amber "Money in" chip');
      eq(credit({ refundTarget: null, ...stored({ included: 1 }) }).included, true, 'and can be ticked, as money back');
      eq(inOut(credit({ refundTarget: 'skipped', ...stored({ included: 1 }) })), [['purchase_skipped'], false, null, null], "a refund of a purchase that isn't imported can't be ticked");
      eq(inOut(credit({ refundTarget: 'same_month', ...stored({ included: 0 }) })), [['refund'], false, 'refund', null], 'a refund can be unticked');
      eq(keys(credit({ refundTarget: 'same_month', spentOn: '2026-10-02' })), ['refund', 'out_of_month'], 'outside the month it says so');
      eq(credit({ refundTarget: 'same_month', spentOn: '2026-10-02' }).included, false, 'and starts unticked');
      eq(inOut(credit({ refundTarget: 'same_month', ...stored({ kind: 'transfer' }) })), [['transfer'], false, null, null], 'money in marked a transfer writes nothing');
      eq(keys(credit({ prediction: { label: 'transfer', confidence: 0.9 } })), ['transfer'], 'a predicted transfer in is a transfer');
      eq(credit({ ...stored({ categoryId: GROC, included: 0 }) }).teaches, false, 'money in never teaches');
      eq(credit({ refundTarget: 'same_month', duplicates: 1 }).labels.map((l) => l.key), ['refund'], 'and is never a possible duplicate');

      // The catalogue covers every label with display text.
      eq(Object.keys(LABELS).sort(), ['already_imported', 'credit', 'low_confidence', 'money_back', 'not_completed', 'not_in_month', 'ok', 'out_of_month', 'parse_error', 'possible_duplicate', 'purchase_skipped', 'refund', 'transfer', 'uncategorised'], 'every label is catalogued');
      eq(LABELS.not_in_month.text, "Not in this month's plan", 'not_in_month copy');
      eq(LABELS.out_of_month.text, 'Outside this month', 'out_of_month copy');
      eq(LABELS.transfer.severity, 'info', 'a transfer is info');
    }

    /* ---- refunds: which purchase money in gives back for ---- */
    {
      const { merchantWords, merchantLikeness, rankPurchases, REFUND_WINDOW_DAYS } = imp('refunds.js');
      const words = (t) => [...merchantWords(t)];
      eq(words('H&M HENNES ONLINE 4471'), ['hm', 'hennes'], "'&' joins, references and shop words go");
      eq(words('H & M'), ['hm'], 'with or without spaces');
      eq(words('ZARA.COM REFUND'), ['zara'], 'domains and refund words go');
      eq(words('4321 05OCT26 CD , ACME DIRECT , SPRINGFIELD GB'), ['acme', 'direct', 'springfield'], 'card codes and dates go');
      eq(merchantLikeness(merchantWords('ACME DIRECT'), merchantWords('ACME')), 1, 'one shared word out of the shorter name is a full match');
      eq(merchantLikeness(merchantWords('ACME'), merchantWords('ZARA')), 0, 'no shared word is no match');
      eq(REFUND_WINDOW_DAYS, 90, 'refunds look back 90 days');

      const purchase = (id, spentOn, amountCents, name, remainingCents = amountCents) =>
        ({ ref: { kind: 'entry', id }, spentOn, amountCents, remainingCents, names: [name] });
      const refund = { spentOn: '2026-10-12', amountCents: 5000, descriptor: 'HM ONLINE' };
      const ids = (list) => list.map((p) => p.ref.id);
      eq(ids(rankPurchases(refund, [
        purchase(1, '2026-10-05', 10000, 'H&M'),
        purchase(2, '2026-10-08', 10000, 'H&M'),
        purchase(3, '2026-10-09', 10000, 'ZARA'),
        purchase(4, '2026-10-10', 4000, 'H&M'),
        purchase(5, '2026-10-11', 10000, 'H&M', 3000),
        purchase(6, '2026-10-13', 10000, 'H&M'),
        purchase(7, '2026-07-13', 10000, 'H&M'),
        purchase(8, '2026-07-14', 10000, 'H&M'),
      ])), [2, 1, 8], 'same shop, enough left, in the window and not after it; most recent first');
      eq(ids(rankPurchases(refund, [purchase(1, '2026-10-12', 5000, 'HM')])), [1], 'a purchase the same day, refunded in full');
      eq(ids(rankPurchases({ ...refund, descriptor: 'HM HENNES' }, [
        purchase(1, '2026-10-11', 9000, 'HM HOME'),
        { ...purchase(2, '2026-10-01', 9000, 'Shirts'), names: ['Shirts', 'H&M HENNES'] },
      ])), [2, 1], 'the closer name wins over the more recent; any of its names will do');
    }

    console.log('IMPORT_ENGINE_OK');
  } catch (err) {
    console.error('IMPORT_ENGINE_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    app.exit(code);
  }
});
