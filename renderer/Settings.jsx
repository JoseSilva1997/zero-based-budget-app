/* ============================================================
   Settings screen
   ============================================================ */
import React, { useRef } from 'react';
import { Avatar, Icons, TextInline } from './components.jsx';
import { BUDGET_THEMES } from './lib/index.js';
import { ACCT_ICON, ACCT_TYPE_LABEL, hexToSoft } from './Accounts.jsx';

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
  const fileRef = useRef(null);

  const doBackup = async () => {
    // channel: "backup:create" - no input (DB is already current), returns { path, savedAt }.
    if (window.api && typeof window.api.createBackup === "function") {
      try {
        await window.api.createBackup();
        dispatch({ type: "refreshSettings" }); // pick up the new lastBackup from SQL
        toast("Backup saved to your data folder");
      } catch (err) { console.error("backup:create failed", err); toast("Backup failed"); }
      return;
    }
    toast("Backups need the desktop app");
  };
  const doRestore = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    // channel: "backup:restore" - input { filePath }; renderer re-bootstraps after.
    const filePath = window.api && typeof window.api.pathForFile === "function" ? window.api.pathForFile(f) : f.path;
    if (window.api && typeof window.api.restoreBackup === "function" && filePath) {
      try {
        await window.api.restoreBackup(filePath);
        dispatch({ type: "restore" }); // re-hydrate the whole store from the restored DB
        toast("Backup restored");
      } catch (err) { console.error("backup:restore failed", err); toast("Couldn't restore that file"); }
      e.target.value = ""; return;
    }
    toast("Restoring needs the desktop app");
    e.target.value = "";
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
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3, marginBottom: 16, lineHeight: 1.45 }}>Twelve dark palettes. Switch any time - also available from the Tweaks panel.</div>
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
            <TextInline value={m.name} onCommit={(v) => dispatch({ type: "updateMember", id: m.id, patch: { name: v } })} style={{ fontWeight: 500, fontSize: 14 }} />
            <div style={{ display: "flex", gap: 5 }}>
              {MEMBER_COLORS.map(c => (
                <button key={c} onClick={() => dispatch({ type: "updateMember", id: m.id, patch: { color: c } })}
                  style={{ width: 20, height: 20, borderRadius: 99, background: c, border: m.color === c ? "2px solid var(--ink)" : "2px solid transparent", outline: m.color === c ? "1px solid var(--surface)" : "none", cursor: "pointer" }} title="Set color" />
              ))}
            </div>
            <button className="icon-btn" title="Remove member" disabled={s.members.length <= 1} style={{ opacity: s.members.length <= 1 ? .3 : 1 }} onClick={() => dispatch({ type: "removeMember", id: m.id })}><Icons.trash size={16} /></button>
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
              <TextInline value={a.name} onCommit={(v) => dispatch({ type: "updateAccount", id: a.id, patch: { name: v } })} style={{ fontWeight: 500, fontSize: 14 }} />
              <select value={a.type} onChange={(e) => dispatch({ type: "updateAccount", id: a.id, patch: { type: e.target.value } })} className="btn btn-sm" style={{ paddingRight: 8 }}>
                {Object.entries(ACCT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={a.owner || ""} onChange={(e) => dispatch({ type: "updateAccount", id: a.id, patch: { owner: e.target.value || null } })} className="btn btn-sm" style={{ paddingRight: 8 }}>
                <option value="">Shared</option>
                {s.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button className="icon-btn" title="Remove account" onClick={() => dispatch({ type: "removeAccount", id: a.id })}><Icons.trash size={16} /></button>
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
        <Setting title="Restore from backup" sub="Replace all current data with a previously saved backup file.">
          <input ref={fileRef} type="file" accept=".sqlite,application/json" onChange={doRestore} style={{ display: "none" }} />
          <button className="btn" onClick={() => fileRef.current.click()}><Icons.upload size={15} /> Choose file…</button>
        </Setting>
        <Setting title="Data folder" sub="Your database lives in the app's private data folder on this Mac.">
          <button className="btn" onClick={async () => {
            // channel: "data:revealFolder" - input {}, returns { path }.
            if (window.api && typeof window.api.revealDataFolder === "function") {
              try { await window.api.revealDataFolder(); toast("Opening data folder…"); }
              catch (err) { console.error("data:revealFolder failed", err); toast("Couldn't open the data folder"); }
              return;
            }
            toast("Opening data folder…");
          }}><Icons.folder size={15} /> Open in Finder</button>
        </Setting>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", margin: "26px 0 10px", color: "var(--faint)", fontSize: 12 }}>
        <Icons.coins size={14} /> House Budget · local-first · v1.0
      </div>
    </div>
  );
}

export { SettingsScreen };
