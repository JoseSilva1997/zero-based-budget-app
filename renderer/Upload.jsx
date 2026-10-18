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

/* The statement formats House Budget reads, by preset key, as a household
   would name the bank. */
const PRESETS = [["monzo", "Monzo"], ["lloyds", "Lloyds"], ["revolut", "Revolut"], ["natwest", "NatWest"]];
const presetName = (key) => (PRESETS.find(([k]) => k === key) || [key, key])[1];

/* ---- setting an account's bank up, inside its zone ---------------------
   The first statement dropped on an account with no bank (or a Revolut file
   with several products in it) comes back as needs_bank. Rather than a
   dialog over the sheet, the zone itself asks: an existing bank, or a new one
   named here, with the format already chosen from the file's own header; and
   for Revolut, which of the file's products this account is. Choosing sends
   the held files again, so setting a bank up never means dropping the file
   twice. */
function BankSetup({ account, bank, need, onDone, onCancel }) {
  const { imports } = useStore();
  const [banks, setBanks] = useState(null);
  const [bankId, setBankId] = useState("new");
  const [preset, setPreset] = useState(need.preset || "monzo");
  const [name, setName] = useState(presetName(need.preset || "monzo"));
  const [product, setProduct] = useState(need.products && need.products.length ? need.products[0] : "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // An account that already has its bank (a Revolut one still missing its
  // product) keeps it; otherwise a bank already using the file's format is
  // the likeliest answer.
  useEffect(() => {
    let live = true;
    imports.banks().then((list) => {
      if (!live) return;
      setBanks(list);
      const match = bank || list.find((b) => b.preset === need.preset);
      if (match) setBankId(String(match.id));
    }).catch((err) => { if (live) { setBanks([]); setError(err.message); } });
    return () => { live = false; };
  }, [imports, bank, need.preset]);

  const chosen = bankId === "new" ? null : (banks || []).find((b) => String(b.id) === bankId) || null;
  const effectivePreset = chosen ? chosen.preset : preset;
  const askProduct = effectivePreset === "revolut" && need.products && need.products.length > 0;
  const ready = !busy && banks !== null && (chosen || name.trim()) && (!askProduct || product);

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await imports.setUpBank({
        accountId: account.id,
        bankId: chosen ? chosen.id : null,
        newBank: chosen ? null : { name: name.trim(), preset },
        product: askProduct ? product : null,
      });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const typePreset = (v) => {
    // Keep a name the household typed; follow the format only while the name
    // is still the one this form suggested.
    if (name === presetName(preset)) setName(presetName(v));
    setPreset(v);
  };

  return (
    <form className="upload-setup" onSubmit={submit}>
      <div className="upload-setup-lead">{need.preset
        ? `This looks like a ${presetName(need.preset)} statement. Which bank is ${account.name} with?`
        : `House Budget couldn't tell which bank this statement is from. Which bank is ${account.name} with?`}</div>
      <div className="upload-setup-fields">
        <select className="sel tinput tray" value={bankId} aria-label={`Bank for ${account.name}`}
          onChange={(e) => setBankId(e.target.value)}>
          {(banks || []).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          <option value="new">A new bank…</option>
        </select>
        {!chosen && (
          <>
            <input className="tinput tray" value={name} aria-label="Name of the new bank" placeholder="Bank name"
              onChange={(e) => setName(e.target.value)} />
            <select className="sel tinput tray" value={preset} aria-label={`Statement format for ${account.name}`}
              onChange={(e) => typePreset(e.target.value)}>
              {PRESETS.map(([k, label]) => <option key={k} value={k}>{label} format</option>)}
            </select>
          </>
        )}
        {askProduct && (
          <select className="sel tinput tray" value={product} aria-label={`Revolut account for ${account.name}`}
            onChange={(e) => setProduct(e.target.value)}>
            {need.products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="upload-setup-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ready}>{busy ? "Working…" : "Use this bank"}</button>
      </div>
    </form>
  );
}

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
  // { files, preset, products } while the account's bank is being set up:
  // the file that asked, and every one dropped with it after it.
  const [need, setNeed] = useState(null);

  const send = async (list) => {
    setError(null);
    setNeed(null);
    setBusy(true);
    try {
      for (let i = 0; i < list.length; i++) {
        try {
          const res = await imports.upload(month, account.id, list[i]);
          if (res && res.status === "needs_bank") {
            setNeed({ files: list.slice(i), preset: res.preset, products: res.products });
            break;
          }
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

      {need ? (
        <BankSetup account={account} bank={bank} need={need}
          onCancel={() => setNeed(null)}
          onDone={() => send(need.files)} />
      ) : (
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
      )}

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
