/* ============================================================
   Settings screen
   ============================================================ */
import React, { useEffect, useRef, useState } from 'react';
import { Avatar, ConfirmDialog, Icons, Modal, TextInline } from './components.jsx';
import { BUDGET_THEMES } from './lib/index.js';
import { ACCT_ICON, ACCT_TYPE_LABEL, hexToSoft } from './Accounts.jsx';

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
  const api = window.api;

  useEffect(() => {
    let live = true;
    if (!api || typeof api.listBackups !== "function") { setBackups([]); return; }
    api.listBackups()
      .then((list) => { if (live) setBackups(list); })
      .catch((e) => { if (live) { setBackups([]); setErr(e.message); } });
    return () => { live = false; };
  }, [api]);

  const choose = async (filePath) => {
    setErr(null);
    try { setPending(await api.previewBackup(filePath)); }
    catch (e) { setErr(e.message); }
  };

  const onPickFile = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const filePath = typeof api.pathForFile === "function" ? api.pathForFile(f) : f.path;
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
        <span style={{ display: "block", marginBottom: 12 }}>
          You have {plural(live.months, "month", "months")} and {plural(live.entries, "spending entry", "spending entries")} right now.
          This backup from {incoming.savedAt} holds {plural(incoming.months, "month", "months")} and {plural(incoming.entries, "spending entry", "spending entries")}.
        </span>
        <span style={{ display: "block", color: "var(--ink-2)" }}>
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
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "var(--neg-soft)", color: "var(--neg-ink)", padding: "10px 12px", borderRadius: 10, fontSize: 13, marginBottom: 14, lineHeight: 1.45 }}>
          <Icons.alert size={16} style={{ flex: "none", marginTop: 1 }} /> {err}
        </div>
      )}

      <div className="scroll-list" style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
        {backups === null && <div style={{ padding: "18px", color: "var(--muted)", fontSize: 13 }}>Looking for backups…</div>}
        {backups !== null && backups.length === 0 && (
          <div style={{ padding: "20px", color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
            No backups yet. Use <strong style={{ color: "var(--ink-2)" }}>Back up now</strong> to make one, or choose a file below.
          </div>
        )}
        {(backups || []).map((b, i) => (
          <button key={b.path} type="button" onClick={() => choose(b.path)}
            style={{ width: "100%", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", textAlign: "left", padding: "11px 14px", border: 0, borderTop: i ? "1px solid var(--hairline)" : "none", background: "transparent", color: "var(--ink)", cursor: "pointer", font: "inherit" }}>
            <Icons.folder size={16} style={{ color: "var(--faint)" }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 500 }}>{b.savedAt}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.fileName}</span>
            </span>
            <span className="mono" style={{ fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap" }}>{fileSize(b.size)}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18 }}>
        <>
          <input ref={fileRef} type="file" accept=".sqlite" onChange={onPickFile} style={{ display: "none" }} />
          <button className="btn btn-sm btn-ghost" style={{ color: "var(--muted)" }} onClick={() => fileRef.current.click()}>
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
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "center", padding: "18px 22px", borderTop: "1px solid var(--hairline)" }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>{title}</div>
        {sub && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3, lineHeight: 1.45, maxWidth: 460 }}>{sub}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{children}</div>
    </div>
  );
}

function SettingsScreen({ state, dispatch, currency, toast }) {
  const s = state.settings;
  const [restoring, setRestoring] = useState(false);
  const [removeMember, setRemoveMember] = useState(null);
  const [removeAccount, setRemoveAccount] = useState(null);

  const doBackup = async () => {
    // channel: "backup:create" - no input (DB is already current), returns { path, savedAt }.
    if (window.api && typeof window.api.createBackup === "function") {
      try {
        await window.api.createBackup();
        dispatch({ type: "refreshSettings" }); // pick up the new lastBackup from SQL
        toast("Backup saved to your data folder");
      } catch (err) { console.error("backup:create failed", err); toast(`Backup failed. ${err.message}`, "error"); }
      return;
    }
    toast("Backups need the desktop app", "error");
  };

  const onRestored = (res) => {
    setRestoring(false);
    dispatch({ type: "restore" }); // re-hydrate the whole store from the restored DB
    toast(`Restored. Your previous data was saved as ${res.safetyCopy}`);
  };

  const CURRENCIES = ["$", "£", "€", "¥", "₹", "C$", "A$"];
  const AUTO = [["off", "Off"], ["onclose", "On app close"], ["daily", "Once a day"]];
  const MEMBER_COLORS = ["#2fbf87", "#f0894e", "#5b8def", "#a87bf0", "#e0b84a", "#fb5e7e"];

  return (
    <div className="fade-in" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="topbar"><div><div className="page-title">Settings</div><div className="page-sub">Preferences for this household. Everything stays on this device.</div></div></div>

      <div className="section-head"><h2>General</h2></div>
      <div className="card">
        <Setting title="Currency symbol" sub="Shown before every amount across the app.">
          <div style={{ display: "flex", gap: 6 }}>
            {CURRENCIES.map(c => (
              <button key={c} onClick={() => dispatch({ type: "updateSettings", patch: { currency: c } })}
                className="mono" style={{ width: 38, height: 36, borderRadius: 8, border: `1px solid ${s.currency === c ? "var(--accent)" : "var(--border)"}`, background: s.currency === c ? "var(--accent-soft)" : "var(--surface)", color: s.currency === c ? "var(--accent-ink)" : "var(--ink-2)", fontWeight: 600 }}>{c}</button>
            ))}
          </div>
        </Setting>
      </div>

      <div className="section-head"><h2>Appearance</h2></div>
      <div className="card" style={{ padding: "18px 22px" }}>
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>Theme</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3, marginBottom: 16, lineHeight: 1.45 }}>Twelve dark palettes. Switch any time; amounts keep their meaning in every one.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {BUDGET_THEMES.map((th) => {
            const on = s.theme === th.id;
            return (
              <button key={th.id} onClick={() => dispatch({ type: "updateSettings", patch: { theme: th.id } })}
                style={{
                  position: "relative", display: "flex", alignItems: "center", gap: 11,
                  padding: "12px 14px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                  background: th.bg,
                  border: on ? `1px solid ${th.accent}` : "1px solid rgba(255,255,255,0.12)",
                  boxShadow: on ? `0 0 0 2px ${th.accent}55, 0 8px 20px -8px ${th.accent}77` : "none",
                  transition: "box-shadow .15s, border-color .15s, transform .12s",
                }}>
                <span style={{ width: 22, height: 22, borderRadius: 7, flex: "none", background: `linear-gradient(150deg, ${th.accent}, ${th.accent})`, boxShadow: `0 0 12px ${th.accent}aa` }} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>{th.label}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>{on ? "Active" : "\u00a0"}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="section-head"><h2>Household members</h2></div>
      <div className="card">
        {s.members.map(m => (
          <div key={m.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, alignItems: "center", padding: "12px 22px", borderTop: "1px solid var(--hairline)" }}>
            <Avatar member={m} size={32} />
            <TextInline value={m.name} col="memberName" label="Member name" onCommit={(v) => dispatch({ type: "updateMember", id: m.id, patch: { name: v } })} style={{ fontWeight: 500, fontSize: 14 }} />
            <div style={{ display: "flex", gap: 5 }}>
              {MEMBER_COLORS.map(c => (
                <button key={c} onClick={() => dispatch({ type: "updateMember", id: m.id, patch: { color: c } })}
                  style={{ width: 20, height: 20, borderRadius: 99, background: c, border: m.color === c ? "2px solid var(--ink)" : "2px solid transparent", outline: m.color === c ? "1px solid var(--surface)" : "none", cursor: "pointer" }} title="Set color" />
              ))}
            </div>
            <button className="icon-btn" title="Remove member" disabled={s.members.length <= 1} style={{ opacity: s.members.length <= 1 ? .3 : 1 }} onClick={() => setRemoveMember(m)}><Icons.trash size={16} /></button>
          </div>
        ))}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--hairline)" }}>
          <button className="btn btn-sm btn-ghost" style={{ color: "var(--muted)" }} onClick={() => dispatch({ type: "addMember", name: "New member", color: MEMBER_COLORS[s.members.length % MEMBER_COLORS.length] })}><Icons.plus size={14} /> Add member</button>
        </div>
      </div>

      <div className="section-head"><h2>Funding accounts</h2></div>
      <div className="card">
        <div style={{ padding: "12px 22px", fontSize: 12.5, color: "var(--muted)", borderTop: "1px solid var(--hairline)", lineHeight: 1.5 }}>
          Accounts are <em>where</em> money lives - main accounts, shared/joint, wallets like Revolut, or savings. Assign each budget item to one account, and the Month Budget funding plan shows who moves what.
        </div>
        {(s.accounts || []).map(a => {
          const owner = s.members.find(m => m.id === a.owner);
          return (
            <div key={a.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr 150px 130px auto", gap: 12, alignItems: "center", padding: "12px 22px", borderTop: "1px solid var(--hairline)" }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, flex: "none", background: hexToSoft(a.color), color: a.color, display: "grid", placeItems: "center" }}>{React.createElement(Icons[ACCT_ICON[a.type] || "coins"], { size: 16 })}</span>
              <TextInline value={a.name} col="accountName" label="Account name" onCommit={(v) => dispatch({ type: "updateAccount", id: a.id, patch: { name: v } })} style={{ fontWeight: 500, fontSize: 14 }} />
              <select value={a.type} aria-label={`Account type for ${a.name}`} onChange={(e) => dispatch({ type: "updateAccount", id: a.id, patch: { type: e.target.value } })} className="btn btn-sm" style={{ paddingRight: 8 }}>
                {Object.entries(ACCT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={a.owner || ""} aria-label={`Who owns ${a.name}`} onChange={(e) => dispatch({ type: "updateAccount", id: a.id, patch: { owner: e.target.value || null } })} className="btn btn-sm" style={{ paddingRight: 8 }}>
                <option value="">Shared</option>
                {s.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button className="icon-btn" title="Remove account" onClick={() => setRemoveAccount(a)}><Icons.trash size={16} /></button>
            </div>
          );
        })}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--hairline)" }}>
          <button className="btn btn-sm btn-ghost" style={{ color: "var(--muted)" }} onClick={() => dispatch({ type: "addAccount", name: "New account", color: MEMBER_COLORS[(s.accounts || []).length % MEMBER_COLORS.length], accType: "main" })}><Icons.plus size={14} /> Add account</button>
        </div>
      </div>

      <div className="section-head"><h2>Data &amp; backup</h2></div>
      <div className="card">
        <Setting title="Manual backup" sub={`Save a snapshot of all your budget data to a file. Last backup: ${s.lastBackup || "never"}.`}>
          <button className="btn btn-primary" onClick={doBackup}><Icons.download size={15} /> Back up now</button>
        </Setting>
        <Setting title="Automatic backups" sub="When the app should quietly save a snapshot for you.">
          <div style={{ display: "flex", gap: 4, background: "var(--surface-sunken)", padding: 4, borderRadius: 10 }}>
            {AUTO.map(([val, label]) => (
              <button key={val} onClick={() => dispatch({ type: "updateSettings", patch: { autoBackup: val } })}
                style={{ padding: "7px 12px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: 500, background: s.autoBackup === val ? "var(--surface)" : "transparent", color: s.autoBackup === val ? "var(--ink)" : "var(--muted)", boxShadow: s.autoBackup === val ? "var(--shadow-sm)" : "none" }}>{label}</button>
            ))}
          </div>
        </Setting>
        <Setting title="Restore from backup" sub="Go back to a saved snapshot. You'll see what it contains and confirm before anything is replaced, and your current data is backed up first.">
          <button className="btn" onClick={() => setRestoring(true)}><Icons.upload size={15} /> Restore…</button>
        </Setting>
        <Setting title="Data folder" sub="Your budget file and its backups live in the app's private data folder on this device.">
          <button className="btn" onClick={async () => {
            // channel: "data:revealFolder" - input {}, returns { path }.
            if (window.api && typeof window.api.revealDataFolder === "function") {
              try { await window.api.revealDataFolder(); toast("Opening data folder…"); }
              catch (err) { console.error("data:revealFolder failed", err); toast(`Couldn't open the data folder. ${err.message}`, "error"); }
              return;
            }
            toast("Opening the data folder needs the desktop app", "error");
          }}><Icons.folder size={15} /> Open data folder</button>
        </Setting>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", margin: "26px 0 10px", color: "var(--faint)", fontSize: 12 }}>
        <Icons.coins size={14} /> House Budget · local-first · v1.0
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
