/* ============================================================
   Upload transactions - the sheet that turns bank statements into entries.

   Two steps in one sheet. Upload: a drop zone per bank account, each taking
   one or more CSVs. Review: every parsed row in one list, a separator per
   account, with the classifier's guess and the labels that say why a row is
   or is not ticked. Confirm writes the ticked rows as entries in the month
   you are on.

   The review is the server's, recomputed on every read (classifier, labels,
   duplicates), so after any change the sheet reads it again rather than
   patching its own copy. Only the over-plan line is worked out here, because
   it has to follow every tick as it happens.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Icons, Sheet } from './ui/index.js';
import { cx, monthLabel } from './lib/index.js';
import { useStore } from './store.jsx';

/* ---- one account's drop zone ------------------------------------------ */
function DropZone({ entry }) {
  const { account, bank } = entry;
  return (
    <section className="panel upload-zone" data-account-zone={account.id} aria-label={`Statements for ${account.name}`}>
      <div className="upload-zone-head">
        <div className="upload-zone-name truncate">{account.name}</div>
        <div className={cx("upload-zone-bank", !bank && "is-unset")}>{bank ? bank.name : "No bank yet"}</div>
      </div>
      <label className="upload-drop">
        <Icons.upload size={18} />
        <span>Drop CSV statements here, or</span>
        <span className="btn btn-sm upload-choose">Choose files</span>
        <input type="file" multiple accept=".csv,text/csv" className="sr-only" />
      </label>
    </section>
  );
}

/* ---- the upload step --------------------------------------------------- */
function UploadStep({ review }) {
  return (
    <div className="upload-zones">
      {review.accounts.map((entry) => <DropZone key={entry.account.id} entry={entry} />)}
    </div>
  );
}

/* ---- the sheet --------------------------------------------------------- */
function UploadSheet({ month, currency, onClose }) {
  const { imports } = useStore();
  const [review, setReview] = useState(null);

  const load = useCallback(async () => {
    const r = await imports.review(month);
    setReview(r);
    return r;
  }, [imports, month]);
  useEffect(() => { load(); }, [load]);

  return (
    <Sheet label="Upload transactions" closeLabel="Close the upload" onClose={onClose}
      head={
        <div className="upload-head-id">
          <span className="upload-head-mark"><Icons.upload size={18} /></span>
          <div>
            <div className="upload-head-title">Upload transactions</div>
            <div className="upload-head-sub">Into {monthLabel(month).mo} {monthLabel(month).yr}</div>
          </div>
        </div>
      }>
      {review && <UploadStep review={review} />}
    </Sheet>
  );
}

export { UploadSheet };
