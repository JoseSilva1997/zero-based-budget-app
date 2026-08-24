/* ============================================================
   Settings screen
   ============================================================ */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, ConfirmDialog, Icons, Modal, PageHeader, Section, TextInline, Tile } from './ui/index.js';
import { BUDGET_THEMES, cx } from './lib/index.js';
import { api, can } from './lib/api.js';
import { useStore } from './store.jsx';
import { ACCT_ICON, ACCT_TYPE_LABEL } from './Accounts.jsx';
import { UpdateSettings } from './UpdateBanner.jsx';

/* ---- shortcuts ----------------------------------------------------------
   The menu accelerators are fetched from the main process rather than
   restated here, so this section cannot drift from what the menu binds.
   These in-app keys have no menu entry, so they are listed by hand; keep
   them in step with the components named beside each group.

   The two kinds are listed apart rather than merged: a menu accelerator
   answers wherever you are, an in-app key only answers inside the field,
   list or dialog it belongs to, and that is the difference a reader needs. */
const IN_APP_SHORTCUTS = [
  { group: "Editing the budget", label: "Commit and move down the same column", keys: ["Enter"] },
  { group: "Editing the budget", label: "Commit and move up the same column", keys: ["Shift", "Enter"] },
  { group: "Editing the budget", label: "Discard the edit and leave the field", keys: ["Esc"] },
  { group: "Editing the budget", label: "Step an entry's day up or down", keys: ["↑", "↓"], alt: true },
  { group: "Find", label: "Next match", keys: ["Enter"] },
  { group: "Find", label: "Previous match", keys: ["Shift", "Enter"] },
  { group: "Find", label: "Next / previous match", keys: ["↓", "↑"], alt: true },
  { group: "Find", label: "Close find", keys: ["Esc"] },
  { group: "Quick entry", label: "Move through the suggestions", keys: ["↓", "↑"], alt: true },
  { group: "Quick entry", label: "Pick the highlighted suggestion, or log the entry", keys: ["Enter"] },
  { group: "Quick entry", label: "Close the suggestion list", keys: ["Esc"] },
  { group: "Dialogs", label: "Close the Wallet, a dialog or a modal", keys: ["Esc"] },
];

/* `alt` rows are alternatives ("↓ or ↑"); everything else is a chord. */
function Keys({ keys, alt }) {
  return (
    <span className="keys">
      {keys.map((k, i) => (
        <React.Fragment key={k}>
          {i > 0 && <span className="keys-sep">{alt ? "/" : "+"}</span>}
          <kbd>{k}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

/* Fixed group order, so the section reads the same however the menu list
   happens to arrive from the main process. Anything unlisted follows, by name. */
const GROUP_ORDER = ["Actions", "Navigation", "Editing the budget", "Quick entry", "Find", "Dialogs"];

function groupByTitle(rows) {
  const out = [];
  rows.forEach((r) => {
    const g = out.find((x) => x.title === r.group);
    if (g) g.rows.push(r); else out.push({ title: r.group, rows: [r] });
  });
  const rank = (t) => { const i = GROUP_ORDER.indexOf(t); return i === -1 ? GROUP_ORDER.length : i; };
  return out.sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title));
}

function ShortcutGroup({ title, rows, first }) {
  return (
    <div className={cx("sc-group", first && "is-first")}>
      <div className="eyebrow sc-group-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="sc-row">
          <span className="sc-label">{r.label}</span>
          <Keys keys={r.keys} alt={r.alt} />
        </div>
      ))}
    </div>
  );
}

function ShortcutsSection() {
  const [menuShortcuts, setMenuShortcuts] = useState([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    if (!can("shortcuts")) { setFailed(true); return; }
    // channel: "shortcuts:list" - input {}, returns ShortcutDoc[].
    api.shortcuts()
      .then((rows) => { if (live) setMenuShortcuts(rows); })
      .catch((err) => { console.error("shortcuts:list failed", err); if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const sections = [
    { kind: "menu", title: "From the application menu", note: "These answer anywhere in the app.", groups: groupByTitle(menuShortcuts) },
    { kind: "in-app", title: "Inside the app", note: "These answer only where they apply: the field you're editing, the list that's open, the dialog in front of you.", groups: groupByTitle(IN_APP_SHORTCUTS) },
  ].filter((s) => s.groups.length);

  return (
    <div className="panel">
      {failed && (
        <div className="set-row sc-failed">
          The menu shortcuts couldn't be read, so only the in-app keys are listed below.
        </div>
      )}
      {sections.map((s) => (
        <div key={s.kind}>
          {/* One level deeper than the other .set-row callers, inside this
              per-section wrapper: the stylesheet reaches it, so the first
              section's heading loses the rule and the second one keeps it as
              the divider between the two. */}
          <div className="set-row sc-head">
            <div className="sc-head-title">{s.title}</div>
            <div className="sc-head-note">{s.note}</div>
          </div>
          {s.groups.map((g, i) => <ShortcutGroup key={g.title} title={g.title} rows={g.rows} first={i === 0} />)}
        </div>
      ))}
    </div>
  );
}

function fileSize(n) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---- restore ------------------------------------------------------------
   Restore is the only irreversible action in the app, so it is staged rather
   than fired from a file picker: choose from the app's own dated snapshots,
   see what the file actually contains next to what you have now, then confirm.
   A safety snapshot of the current data is taken by the main process first. */
function RestoreDialog({ onClose, onRestored }) {
  const [backups, setBackups] = useState(null); // null while loading
  const [pending, setPending] = useState(null); // validated { live, incoming }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    let live = true;
    if (!can("listBackups")) { setBackups([]); return; }
    api.listBackups()
      .then((list) => { if (live) setBackups(list); })
      .catch((e) => { if (live) { setBackups([]); setErr(e.message); } });
    return () => { live = false; };
  }, []);

  const choose = async (filePath) => {
    setErr(null);
    try { setPending(await api.previewBackup(filePath)); }
    catch (e) { setErr(e.message); }
  };

  const onPickFile = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const filePath = can("pathForFile") ? api.pathForFile(f) : f.path;
    if (filePath) choose(filePath);
  };

  const confirm = async () => {
    setBusy(true); setErr(null);
    try { onRestored(await api.restoreBackup(pending.incoming.path)); }
    catch (e) { setErr(e.message); setBusy(false); setPending(null); }
  };

  if (pending) {
    const { live, incoming } = pending;
    return (
      <ConfirmDialog title="Replace everything with this backup?" width={520}
        confirmLabel="Replace my data" icon={<Icons.upload size={15} />}
        busy={busy} onClose={() => setPending(null)} onConfirm={confirm}>
        <span className="restore-summary">
          You have {plural(live.months, "month", "months")} and {plural(live.entries, "spending entry", "spending entries")} right now.
          This backup from {incoming.savedAt} holds {plural(incoming.months, "month", "months")} and {plural(incoming.entries, "spending entry", "spending entries")}.
        </span>
        <span className="restore-note">
          Your current data is saved to a new backup first, so you can come back to it from this same list.
        </span>
      </ConfirmDialog>
    );
  }

  return (
    <Modal onClose={onClose} width={560} label="Restore from backup">
      <h3>Restore from backup</h3>
      <p>Pick a snapshot to go back to. Nothing changes until you confirm on the next screen.</p>

      {err && (
        <Alert className="restore-error">{err}</Alert>
      )}

      <div className="scroll-list backup-list">
        {backups === null && <div className="backup-loading">Looking for backups…</div>}
        {backups !== null && backups.length === 0 && (
          <div className="backup-empty">
            No backups yet. Use <strong>Back up now</strong> to make one, or choose a file below.
          </div>
        )}
        {(backups || []).map((b, i) => (
          <button key={b.path} type="button" onClick={() => choose(b.path)}
            className={cx("backup-item", i && "is-ruled")}>
            <Icons.folder size={16} className="backup-item-icon" />
            <span className="backup-item-text">
              <span className="backup-item-date">{b.savedAt}</span>
              <span className="backup-item-file truncate">{b.fileName}</span>
            </span>
            <span className="num backup-item-size">{fileSize(b.size)}</span>
          </button>
        ))}
      </div>

      <div className="restore-foot">
        <>
          <input ref={fileRef} type="file" accept=".sqlite" onChange={onPickFile} className="restore-file-input" />
          <button className="btn btn-sm btn-ghost btn-quiet" onClick={() => fileRef.current.click()}>
            <Icons.folder size={14} /> Choose a file instead…
          </button>
        </>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function Setting({ title, sub, children }) {
  return (
    <div className="set-row set-item">
      <div>
        <div className="set-title">{title}</div>
        {sub && <div className="set-sub">{sub}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function SettingsScreen({ state, dispatch, currency, toast }) {
  const s = state.settings;
  const { backupNow } = useStore();
  const [restoring, setRestoring] = useState(false);
  const [removeMember, setRemoveMember] = useState(null);
  const [removeAccount, setRemoveAccount] = useState(null);
  // Asked for rather than typed, so this and Help > Version cannot drift.
  const [version, setVersion] = useState(null);
  useEffect(() => {
    // channel: "app:version" - input {}, returns the string from app.getVersion().
    if (!can("appVersion")) return;
    let live = true;
    api.appVersion()
      .then((v) => { if (live) setVersion(v); })
      .catch((err) => console.error("app:version failed", err));
    return () => { live = false; };
  }, []);

  const onRestored = (res) => {
    setRestoring(false);
    dispatch({ type: "restore" }); // re-hydrate the whole store from the restored DB
    toast(`Restored. Your previous data was saved as ${res.safetyCopy}`);
  };

  const CURRENCIES = ["$", "£", "€", "¥", "₹", "C$", "A$"];
  const AUTO = [["off", "Off"], ["onclose", "On app close"], ["daily", "Once a day"]];
  const MEMBER_COLORS = ["#2fbf87", "#f0894e", "#5b8def", "#a87bf0", "#e0b84a", "#fb5e7e"];
  // A swatch that differs only by its fill is six identical buttons to anyone
  // who cannot see it, so each one is named by the colour it actually sets.
  const COLOR_NAME = { "#2fbf87": "Green", "#f0894e": "Orange", "#5b8def": "Blue", "#a87bf0": "Purple", "#e0b84a": "Gold", "#fb5e7e": "Pink" };

  return (
    /* Full width, like every other screen's .fade-in, so these panels reach the
       same right edge as the rest of the app. Individual rows cap their own
       prose (the `sub` line tops out at 460px) so a wide window doesn't stretch
       sentences thin. */
    <div className="fade-in">
      <PageHeader title="Settings" sub="Preferences for this household. Everything stays on this device." />

      <Section title="General" />
      <div className="panel is-feature">
        <Setting title="Currency symbol" sub="Shown before every amount across the app.">
          {/* A radiogroup in a segmented tray. */}
          <div role="radiogroup" aria-label="Currency symbol" className="chip-tray">
            {CURRENCIES.map(c => {
              const on = s.currency === c;
              return (
                <button key={c} role="radio" aria-checked={on} aria-label={`Use ${c} as the currency symbol`}
                  onClick={() => dispatch({ type: "updateSettings", patch: { currency: c } })}
                  className={cx("num", "chip-radio", "currency-chip", on && "is-on")}>
                  {c}
                  {on && (
                    <span className="chip-tick">
                      <Icons.check size={10} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Setting>
      </div>

      <Section title="Appearance" />
      <div className="panel is-feature theme-panel">
        <div className="theme-heading">Theme</div>
        {/* Driven entirely by BUDGET_THEMES: a theme added to that registry
            appears here with no change to this file.

            Each card is painted with the theme it previews rather than the one
            the app is wearing, which is why th.bg is inline and why
            .theme-card's borders are fixed rgba() values. Selection is the
            accent ring plus the ACTIVE caption in the corner. */}
        <div role="radiogroup" aria-label="Theme" className="theme-grid">
          {BUDGET_THEMES.map((th) => {
            const on = s.theme === th.id;
            return (
              <button key={th.id} role="radio" aria-checked={on} aria-label={`${th.label} theme`}
                onClick={() => dispatch({ type: "updateSettings", patch: { theme: th.id } })}
                className={cx("theme-card", on && "is-on")}
                style={{ background: th.bg }}>
                <span className="theme-card-name">{th.label}</span>
                {on && (
                  <span className="theme-card-active">Active</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Section title="Household members" />
      <div className="panel">
        {s.members.map(m => (
          <div key={m.id} className="set-row member-row">
            <Avatar member={m} size={32} />
            <TextInline value={m.name} col="memberName" label="Member name" onCommit={(v) => dispatch({ type: "updateMember", id: m.id, patch: { name: v } })} className="set-inline-name" />
            {/* Hover-revealed: six colour dots per member on every resting row
                would be the noisiest thing on the screen, and picking a colour
                is a once-a-year act. Keyboard focus reveals them the same
                way. */}
            <div className="row-actions member-actions">
              <div role="radiogroup" aria-label={`Colour for ${m.name}`} className="swatch-row">
                {MEMBER_COLORS.map(c => {
                  const on = m.color === c;
                  return (
                    <button key={c} role="radio" aria-checked={on} aria-label={COLOR_NAME[c] || c}
                      title={COLOR_NAME[c] || c}
                      onClick={() => dispatch({ type: "updateMember", id: m.id, patch: { color: c } })}
                      className={cx("swatch", on && "is-on")}
                      style={{ background: c }}>
                      {/* the swatches are fixed hex, not theme tokens, so the
                          dark tick .swatch sets reads on every one of them */}
                      {on && <Icons.check size={11} />}
                    </button>
                  );
                })}
              </div>
              <button className="icon-btn member-remove" title={`Remove ${m.name}`} aria-label={`Remove ${m.name}`} disabled={s.members.length <= 1} onClick={() => setRemoveMember(m)}><Icons.trash size={16} /></button>
            </div>
          </div>
        ))}
        <div className="set-row set-row-add">
          <button className="btn btn-sm btn-ghost btn-quiet" onClick={() => dispatch({ type: "addMember", name: "New member", color: MEMBER_COLORS[s.members.length % MEMBER_COLORS.length] })}><Icons.plus size={14} /> Add member</button>
        </div>
      </div>

      <Section title="Funding accounts" />
      <div className="panel">
        <div className="set-row acct-note">
          Where money actually sits: a current account, a joint one, a savings pot.
          Each budget item is funded from one of these, and the Wallet then shows who moves what.
        </div>
        {(s.accounts || []).map(a => {
          const owner = s.members.find(m => m.id === a.owner);
          return (
            <div key={a.id} className="set-row account-row">
              <Tile size="sm" icon={Icons[ACCT_ICON[a.type] || "coins"]} tint={a.color} />
              <TextInline value={a.name} col="accountName" label="Account name" onCommit={(v) => dispatch({ type: "updateAccount", id: a.id, patch: { name: v } })} className="set-inline-name" />
              <select value={a.type} aria-label={`Account type for ${a.name}`} onChange={(e) => dispatch({ type: "updateAccount", id: a.id, patch: { type: e.target.value } })} className="btn btn-sm account-select">
                {Object.entries(ACCT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={a.owner || ""} aria-label={`Who owns ${a.name}`} onChange={(e) => dispatch({ type: "updateAccount", id: a.id, patch: { owner: e.target.value || null } })} className="btn btn-sm account-select">
                <option value="">Shared</option>
                {s.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <div className="row-actions">
                <button className="icon-btn" title={`Remove ${a.name}`} aria-label={`Remove account ${a.name}`} onClick={() => setRemoveAccount(a)}><Icons.trash size={16} /></button>
              </div>
            </div>
          );
        })}
        <div className="set-row set-row-add">
          <button className="btn btn-sm btn-ghost btn-quiet" onClick={() => dispatch({ type: "addAccount", name: "New account", color: MEMBER_COLORS[(s.accounts || []).length % MEMBER_COLORS.length], accType: "main" })}><Icons.plus size={14} /> Add account</button>
        </div>
      </div>

      <Section title="Data & backup" />
      <div className="panel">
        <Setting title="Manual backup" sub={`Save a snapshot of all your budget data to a file. Last backup: ${s.lastBackup || "never"}.`}>
          <button className="btn btn-primary" onClick={backupNow}><Icons.download size={15} /> Back up now</button>
        </Setting>
        <Setting title="Automatic backups" sub="When the app should quietly save a snapshot for you.">
          <div role="radiogroup" aria-label="Automatic backups" className="chip-tray">
            {AUTO.map(([val, label]) => {
              const on = s.autoBackup === val;
              return (
                <button key={val} role="radio" aria-checked={on} onClick={() => dispatch({ type: "updateSettings", patch: { autoBackup: val } })}
                  className={cx("seg-item", on && "is-on")}>
                  {/* the tick keeps its space when hidden, so choosing an option
                      does not shuffle the other two sideways - see .seg-check */}
                  <Icons.check size={12} className="seg-check" />
                  {label}
                </button>
              );
            })}
          </div>
        </Setting>
        <Setting title="Restore from backup" sub="Go back to a saved snapshot. You'll see what it contains and confirm before anything is replaced, and your current data is backed up first.">
          <button className="btn" onClick={() => setRestoring(true)}><Icons.upload size={15} /> Restore…</button>
        </Setting>
        <Setting title="Data folder" sub="Your budget file and its backups live in the app's private data folder on this device.">
          <button className="btn" onClick={async () => {
            // channel: "data:revealFolder" - input {}, returns { path }.
            if (!can("revealDataFolder")) { toast("Opening the data folder needs the desktop app", "error"); return; }
            try { await api.revealDataFolder(); toast("Opening data folder…"); }
            catch (err) { console.error("data:revealFolder failed", err); toast(`Couldn't open the data folder. ${err.message}`, "error"); }
          }}><Icons.folder size={15} /> Open data folder</button>
        </Setting>
      </div>
      <Section title="Shortcuts" />
      <ShortcutsSection />

      <Section title="Updates" />
      <div className="panel"><UpdateSettings /></div>
      <div className="settings-foot">
        <Icons.coins size={14} /> House Budget · local-first{version ? ` · v${version}` : ""}
      </div>


      {restoring && <RestoreDialog onClose={() => setRestoring(false)} onRestored={onRestored} />}

      {removeMember && (
        <ConfirmDialog title={`Remove ${removeMember.name}?`}
          confirmLabel="Remove member" icon={<Icons.trash size={15} />}
          onClose={() => setRemoveMember(null)}
          onConfirm={() => { dispatch({ type: "removeMember", id: removeMember.id }); setRemoveMember(null); }}>
          Any account owned by {removeMember.name} becomes shared. If they have income recorded in any month, the app will keep them so that history stays intact.
        </ConfirmDialog>
      )}

      {removeAccount && (
        <ConfirmDialog title={`Remove "${removeAccount.name}"?`}
          confirmLabel="Remove account" icon={<Icons.trash size={15} />}
          onClose={() => setRemoveAccount(null)}
          onConfirm={() => { dispatch({ type: "removeAccount", id: removeAccount.id }); setRemoveAccount(null); }}>
          Every budget item funded by this account, in every month, becomes unassigned. Your amounts and spending are kept, but the Wallet will no longer know who moves that money.
        </ConfirmDialog>
      )}
    </div>
  );
}

export { SettingsScreen };
