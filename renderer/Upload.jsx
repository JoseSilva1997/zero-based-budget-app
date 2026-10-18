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
import { Alert, Icons, Sheet } from './ui/index.js';
import { cx, monthLabel } from './lib/index.js';
import { useStore } from './store.jsx';

/* ---- one account's drop zone ------------------------------------------
   Takes files from its picker or from a drop, and sends them one at a time:
   a refusal ("That file is already in this upload.") belongs to the file
   that earned it, and the ones after it still go in. What went wrong is said
   inside the zone, in the backend's own words, rather than in a toast that
   would not say which account it was about. */
function DropZone({ entry, month, onChanged }) {
  const { imports } = useStore();
  const { account, bank, files } = entry;
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const send = async (list) => {
    setError(null);
    setBusy(true);
    try {
      for (const file of list) {
        try {
          await imports.upload(month, account.id, file);
        } catch (err) {
          setError(err.message);
        }
      }
    } finally {
      setBusy(false);
      await onChanged();
    }
  };

  const remove = async (file) => {
    setError(null);
    try { await imports.removeFile(file.id); } catch (err) { setError(err.message); }
    await onChanged();
  };

  return (
    <section className="panel upload-zone" data-account-zone={account.id} aria-label={`Statements for ${account.name}`}>
      <div className="upload-zone-head">
        <div className="upload-zone-name truncate">{account.name}</div>
        <div className={cx("upload-zone-bank", !bank && "is-unset")}>{bank ? bank.name : "No bank yet"}</div>
      </div>

      {files.length > 0 && (
        <ul className="upload-files">
          {files.map((f) => (
            <li key={f.id} className="upload-file">
              <Icons.copy size={14} className="upload-file-glyph" />
              <span className="upload-file-name truncate" title={f.filename}>{f.filename}</span>
              <span className="num upload-file-rows">{f.rowCount} {f.rowCount === 1 ? "row" : "rows"}</span>
              <button className="icon-btn compact subtle" onClick={() => remove(f)}
                aria-label={`Remove ${f.filename}`} title="Remove this file"><Icons.x size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      <label className={cx("upload-drop", over && "is-over")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send([...e.dataTransfer.files]); }}>
        <Icons.upload size={18} />
        <span>{busy ? "Reading…" : "Drop CSV statements here, or"}</span>
        {!busy && <span className="btn btn-sm upload-choose">Choose files</span>}
        <input type="file" multiple accept=".csv,text/csv" className="sr-only" disabled={busy}
          onChange={(e) => { const list = [...e.target.files]; e.target.value = ""; if (list.length) send(list); }} />
      </label>

      {error && <Alert className="upload-zone-error">{error}</Alert>}
    </section>
  );
}

/* ---- the upload step --------------------------------------------------- */
function UploadStep({ review, month, onChanged }) {
  return (
    <div className="upload-zones">
      {review.accounts.map((entry) => <DropZone key={entry.account.id} entry={entry} month={month} onChanged={onChanged} />)}
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
      {review && <UploadStep review={review} month={month} onChanged={load} />}
    </Sheet>
  );
}

export { UploadSheet };
