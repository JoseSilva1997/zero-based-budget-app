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
import { Alert, ConfirmDialog, EmptyState, Icons, Sheet, TextInline } from './ui/index.js';
import { cx, fmt, importOutcome, isBlocked, labelCounts, monthLabel, onlyOutOfMonth, shortDate, sinkBlocked } from './lib/index.js';
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
function UploadStep({ review, month, onChanged, onReview }) {
  const fileCount = review.accounts.reduce((n, a) => n + a.files.length, 0);
  return (
    <>
      <div className="upload-zones">
        {review.accounts.map((entry) => <DropZone key={entry.account.id} entry={entry} month={month} onChanged={onChanged} />)}
      </div>
      <div className="upload-foot">
        <span className="upload-foot-note">{fileCount === 0
          ? "Add a statement to at least one account to review it."
          : `${fileCount} ${fileCount === 1 ? "file" : "files"} ready to review.`}</span>
        <button className="btn btn-primary" disabled={fileCount === 0} onClick={onReview}>
          Review <Icons.right size={15} />
        </button>
      </div>
    </>
  );
}

/* ---- one row of the review --------------------------------------------
   The bank's facts (date, amount) are shown and never edited: they are fixed
   on the entry after import if they need fixing. What is yours to decide is
   the tick, the name and the category. */
function ReviewRow({ row, review, currency, onUpdate }) {
  const blocked = isBlocked(row);
  const transfer = row.kind === "transfer";
  const linkedId = row.decisions.linkedEntryId;
  const linked = linkedId != null ? (row.duplicates.find((d) => d.id === linkedId) || { id: linkedId, name: null, spentOn: null }) : null;
  const [picking, setPicking] = useState(false);
  const inert = blocked || !!linked;

  const link = (d) => { setPicking(false); onUpdate(row, { linkedEntryId: d.id }); };

  return (
    <>
      <div className={cx("upload-row", blocked && "is-blocked", linked && "is-linked")} data-row-id={row.id}>
        <input type="checkbox" className="upload-tick" checked={row.included && !inert} disabled={inert}
          aria-label={`Import ${row.name}`}
          onChange={() => onUpdate(row, { included: !row.included })} />
        <span className="num upload-date">{shortDate(row.spentOn)}</span>
        <TextInline value={row.name} className="upload-name" label={`Name for ${row.name}`}
          onCommit={(v) => { if (v !== row.name) onUpdate(row, { name: v }); }} />
        <CategoryPicker row={row} categories={review.categories} disabled={inert || transfer}
          onChange={(categoryId) => onUpdate(row, { categoryId })} />
        <span className="num upload-amount">{row.amountCents == null ? "" : fmt(currency, row.amountCents / 100)}</span>
        {linked ? (
          <span className="upload-linked truncate">
            <Icons.check size={13} />
            Same as {linked.name || "an existing entry"}{linked.spentOn ? `, ${shortDate(linked.spentOn)}` : ""}
          </span>
        ) : <LabelChips row={row} />}
        <span className="upload-actions">
          {linked ? (
            <button type="button" className="upload-toggle is-on" aria-label={`Unlink ${row.name}`}
              title="Not the same spend after all: import it as its own entry"
              onClick={() => onUpdate(row, { linkedEntryId: null })}>Unlink</button>
          ) : (
            <>
              {row.duplicates.length > 0 && !blocked && (
                <button type="button" data-same aria-expanded={picking}
                  className={cx("upload-toggle", picking && "is-open")}
                  title="This is a spend you already typed in: match it instead of importing it twice"
                  onClick={() => setPicking((p) => !p)}>Same as existing</button>
              )}
              {/* Excludes the row and teaches the classifier that this payee is
                  a transfer. Pressed is drawn even at rest, so a row marked as
                  one says so without being hovered. */}
              <button type="button" data-transfer aria-pressed={transfer} disabled={blocked && !transfer}
                className={cx("upload-toggle", transfer && "is-on")}
                title={transfer ? "Treat this as spending again" : "Money moved between your own accounts, not spent"}
                onClick={() => onUpdate(row, { kind: transfer ? "spend" : "transfer" })}>Transfer</button>
            </>
          )}
        </span>
      </div>
      {picking && !linked && (
        <div className="upload-candidates" data-candidates-for={row.id} role="group" aria-label={`Entries ${row.name} may be the same as`}>
          <div className="eyebrow upload-candidates-head">Already in this month</div>
          {row.duplicates.map((d) => (
            <div key={d.id} className="upload-candidate">
              <span className="num upload-date">{shortDate(d.spentOn)}</span>
              <span className="upload-candidate-name truncate">{d.name || "Unnamed"}</span>
              <span className="upload-candidate-cat truncate">{d.categoryName}</span>
              <span className="num upload-amount">{fmt(currency, d.amountCents / 100)}</span>
              <button type="button" className="btn btn-sm" aria-label={`Match to ${d.name || "this entry"}`}
                onClick={() => link(d)}>Match</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* The labels that say why a row is or is not ticked, as chips coloured by
   severity: Ember for a row that cannot be imported, Lantern Amber for one to
   look at first, neutral for a plain note, and no chip at all for 'ok'. This
   is the one place a warning hue appears, a named exception to The One
   Failure Rule (DESIGN.md). The words are the second channel, so colour is
   never the only thing telling two chips apart. A row that could not be read
   carries the reason on its chip, since the chip itself only says that it
   could not. */
const SEVERITY_CLASS = { block: "is-block", warn: "is-warn", info: "is-info" };
function LabelChips({ row }) {
  const shown = row.labels.filter((l) => SEVERITY_CLASS[l.severity]);
  return (
    <span className="upload-chips">
      {shown.map((l) => (
        <span key={l.key} className={cx("upload-chip", SEVERITY_CLASS[l.severity])}
          title={l.key === "parse_error" && row.parseError ? row.parseError : undefined}>{l.text}</span>
      ))}
    </span>
  );
}

/* The category picker: a native select, redrawn like every select in the
   app, grouped by group as quick entry's item picker is. This month's lines
   come first (the server lists them first); a category the month has no
   line for is still offered, under its group marked as such, since picking
   it is how a line gets created at £0. */
function CategoryPicker({ row, categories, disabled, onChange }) {
  const groups = [];
  for (const c of categories) {
    const key = `${c.inMonth ? "in" : "out"}:${c.groupId}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label: c.inMonth ? c.groupName : `${c.groupName} · not this month`, items: [] }));
    g.items.push(c);
  }
  return (
    <select className={cx("tinput sel upload-category", row.categoryId == null && "is-empty")}
      value={row.categoryId == null ? "" : String(row.categoryId)} disabled={disabled}
      aria-label={`Category for ${row.name}`}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
      <option value="">No category</option>
      {groups.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.items.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/* One account's run of rows, under a separator that names the account and
   its bank, with the count kept quiet beside them.

   A statement covering many months brings hundreds of rows whose only
   warning is that they fall outside this one; those fold under a disclosure
   at the foot of the section, closed until asked for, so the month's own
   rows are what the list is about. A filter shows exactly what it found, so
   while one is on nothing folds. */
function AccountSection({ entry, rows, folding, review, currency, onUpdate }) {
  const { account, bank } = entry;
  const [open, setOpen] = useState(false);
  const outside = folding ? rows.filter(onlyOutOfMonth) : [];
  const shown = folding ? rows.filter((r) => !onlyOutOfMonth(r)) : rows;
  const draw = (r) => <ReviewRow key={r.id} row={r} review={review} currency={currency} onUpdate={onUpdate} />;
  return (
    <section className="upload-section" data-account-section={account.id} aria-label={`${account.name} rows`}>
      <div className="upload-separator" data-account-separator>
        <span className="upload-separator-name">{account.name}</span>
        {bank && <span className="upload-separator-bank">{bank.name}</span>}
        <span className="num upload-separator-count">{entry.rows.length} {entry.rows.length === 1 ? "row" : "rows"}</span>
      </div>
      {sinkBlocked(shown).map(draw)}
      {outside.length > 0 && (
        <>
          <button type="button" className={cx("upload-fold", open && "is-open")} data-out-of-month
            aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icons.right size={14} className="upload-fold-caret" />
            <span className="num">{outside.length}</span> {outside.length === 1 ? "row" : "rows"} outside this month
          </button>
          {open && sinkBlocked(outside).map(draw)}
        </>
      )}
    </section>
  );
}

/* The filter row: one chip per label in the review, with its count, across
   every account. One filter at a time; pressing the lit one again clears it.
   These carry no severity colour - they are controls, and the colour belongs
   to the chips on the rows they find. */
function FilterChips({ counts, active, onPick }) {
  if (counts.length === 0) return null;
  return (
    <div className="upload-filters" data-filters role="group" aria-label="Show only rows labelled">
      {counts.map((c) => (
        <button key={c.key} type="button" data-filter={c.key} aria-pressed={active === c.key}
          className={cx("upload-filter", active === c.key && "is-on")}
          onClick={() => onPick(active === c.key ? null : c.key)}>{c.text} · {c.count}</button>
      ))}
    </div>
  );
}

/* ---- the review step --------------------------------------------------- */
function ReviewStep({ review, currency, onUpdate, onBack, onDiscard }) {
  const [filter, setFilter] = useState(null);
  const counts = labelCounts(review.accounts);
  // A filter whose last row has gone (ticked, re-labelled) lets go by itself.
  const active = counts.some((c) => c.key === filter) ? filter : null;
  const sections = review.accounts
    .map((entry) => ({ entry, rows: active ? entry.rows.filter((r) => r.labels.some((l) => l.key === active)) : entry.rows }))
    .filter((s) => s.rows.length > 0);
  return (
    <div data-review className="upload-review">
      <FilterChips counts={counts} active={active} onPick={setFilter} />
      {sections.length === 0 ? (
        <EmptyState icon={Icons.copy} inline>None of these files had a transaction in them to review.</EmptyState>
      ) : (
        <div className="panel is-clipped upload-list">
          {sections.map(({ entry, rows }) => (
            <AccountSection key={entry.account.id} entry={entry} rows={rows} folding={!active} review={review} currency={currency} onUpdate={onUpdate} />
          ))}
        </div>
      )}
      <ReviewFoot review={review} currency={currency} onBack={onBack} onDiscard={onDiscard} />
    </div>
  );
}

/* The review's footer. Confirm, with what it will do said quietly beside it,
   and next to that what the month will be over by once it has: per category,
   worked out here from the ticks as they stand, in the failure hue because
   over plan is the failure. It also catches a row in the wrong category - a
   line that suddenly goes over is usually one. */
function ReviewFoot({ review, currency, onBack, onDiscard }) {
  const out = importOutcome(review);
  const money = (cents) => fmt(currency, cents / 100);
  const parts = [`${out.count} ${out.count === 1 ? "entry" : "entries"} · ${money(out.totalCents)}`];
  if (out.linked) parts.push(`${out.linked} matched`);
  return (
    <div className="upload-foot upload-review-foot">
      <button className="link-btn upload-back" onClick={onBack}><Icons.left size={14} /> Back to files</button>
      <button className="btn btn-sm btn-ghost btn-quiet" onClick={onDiscard}><Icons.trash size={14} /> Discard</button>
      <span className="upload-foot-spacer" />
      {out.over.length > 0 && (
        <span className="upload-over" data-over-plan>
          Over plan after import: {out.over.map((o) => `${o.name} +${money(o.overCents)}`).join(", ")}
        </span>
      )}
      <span className="num upload-summary" data-confirm-summary>{parts.join(" · ")}</span>
      <button className="btn btn-primary" disabled={out.count === 0 && out.linked === 0}>Confirm</button>
    </div>
  );
}

const noop = () => {};

/* ---- the sheet --------------------------------------------------------- */
function UploadSheet({ month, currency, onClose }) {
  const { imports, toast } = useStore();
  const [review, setReview] = useState(null);
  // 'upload' | 'review'. Decided once, on the first read: a pending upload
  // that already has rows reopens on Review, anything else on the zones.
  const [step, setStep] = useState(null);

  const load = useCallback(async () => {
    const r = await imports.review(month);
    setReview(r);
    setStep((s) => s || (r.batch && r.accounts.some((a) => a.rows.length > 0) ? "review" : "upload"));
    return r;
  }, [imports, month]);
  useEffect(() => { load(); }, [load]);

  // The confirmation open over the sheet, if any: { kind: 'discard' } or
  // { kind: 'undo', batch }. While one is open, Escape belongs to it, so the
  // sheet's own close is held off.
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState(false);

  const discard = async () => {
    setBusy(true);
    try {
      await imports.discard(review.batch.id);
      setStep("upload");
    } catch (err) {
      toast(err.message, "error");
    }
    setBusy(false);
    setAsk(null);
    await load();
  };

  /* Every decision is one write and then a fresh read: the server works out
     what the row now is (its labels, its default tick) and the list follows
     that, rather than guessing at it here. A refused write is said in a toast,
     since it belongs to no one zone. */
  const updateRow = useCallback(async (row, patch) => {
    try { await imports.updateRow(row.id, patch); }
    catch (err) { toast(err.message, "error"); }
    await load();
  }, [imports, load, toast]);

  return (
    <Sheet label="Upload transactions" closeLabel="Close the upload" onClose={ask ? noop : onClose}
      head={
        <div className="upload-head-id">
          <span className="upload-head-mark"><Icons.upload size={18} /></span>
          <div>
            <div className="upload-head-title">Upload transactions</div>
            <div className="upload-head-sub">Into {monthLabel(month).mo} {monthLabel(month).yr}</div>
          </div>
        </div>
      }>
      {review && step === "upload" && <UploadStep review={review} month={month} onChanged={load} onReview={() => setStep("review")} />}
      {review && step === "review" && <ReviewStep review={review} currency={currency} onUpdate={updateRow} onBack={() => setStep("upload")}
        onDiscard={() => setAsk({ kind: "discard" })} />}

      {ask && ask.kind === "discard" && (
        <ConfirmDialog title="Discard this upload?" confirmLabel="Discard upload" icon={<Icons.trash size={15} />}
          busy={busy} onClose={() => setAsk(null)} onConfirm={discard}>
          Every file and every choice you have made in this upload goes. Nothing in your budget changes, and you can upload the statements again.
        </ConfirmDialog>
      )}
    </Sheet>
  );
}

export { UploadSheet };
