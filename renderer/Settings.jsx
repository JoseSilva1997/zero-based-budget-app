/* ============================================================
   Settings screen
   ============================================================ */
import React, { useEffect, useRef, useState } from 'react';
import { Avatar, ConfirmDialog, Icons, Modal, TextInline } from './components.jsx';
import { BUDGET_THEMES, ACCENT_COLORS } from './lib/index.js';
import { ACCT_ICON, ACCT_TYPE_LABEL, hexToSoft } from './Accounts.jsx';
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
      {keys.map((k, i) => (
        <React.Fragment key={k}>
          {i > 0 && <span style={{ color: "var(--faint)", fontSize: 11 }}>{alt ? "/" : "+"}</span>}
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
    <div style={{ borderTop: first ? "none" : "1px solid var(--rule-faint)", padding: first ? "10px 22px 16px" : "14px 22px 16px" }}>
      <div style={{ fontSize: 11, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "5px 0" }}>
          <span style={{ fontSize: 13.5, color: "var(--ink-2)", minWidth: 0 }}>{r.label}</span>
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
    if (!window.api || typeof window.api.shortcuts !== "function") { setFailed(true); return; }
    // channel: "shortcuts:list" - input {}, returns ShortcutDoc[].
    window.api.shortcuts()
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
        <div className="set-row" style={{ padding: "14px 22px", fontSize: 13, color: "var(--muted)" }}>
          The menu shortcuts couldn't be read, so only the in-app keys are listed below.
        </div>
      )}
      {sections.map((s) => (
        <div key={s.kind}>
          {/* One level deeper than the other .set-row callers, inside this
              per-section wrapper: the stylesheet reaches it, so the first
              section's heading loses the rule and the second one keeps it as
              the divider between the two. */}
          <div className="set-row" style={{ padding: "16px 22px 0" }}>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>{s.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.45 }}>{s.note}</div>
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
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "var(--breach-soft)", color: "var(--breach-ink)", padding: "10px 12px", borderRadius: 10, fontSize: 13, marginBottom: 14, lineHeight: 1.45 }}>
          <Icons.alert size={16} style={{ flex: "none", marginTop: 1 }} /> {err}
        </div>
      )}

      <div className="scroll-list" style={{ border: "1px solid var(--rule)", borderRadius: 12, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
        {backups === null && <div style={{ padding: "18px", color: "var(--muted)", fontSize: 13 }}>Looking for backups…</div>}
        {backups !== null && backups.length === 0 && (
          <div style={{ padding: "20px", color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
            No backups yet. Use <strong style={{ color: "var(--ink-2)" }}>Back up now</strong> to make one, or choose a file below.
          </div>
        )}
        {(backups || []).map((b, i) => (
          <button key={b.path} type="button" onClick={() => choose(b.path)}
            style={{ width: "100%", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", textAlign: "left", padding: "11px 14px", border: 0, borderTop: i ? "1px solid var(--rule-faint)" : "none", background: "transparent", color: "var(--ink)", cursor: "pointer", font: "inherit" }}>
            <Icons.folder size={16} style={{ color: "var(--faint)" }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 500 }}>{b.savedAt}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.fileName}</span>
            </span>
            <span className="num" style={{ fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap" }}>{fileSize(b.size)}</span>
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
    <div className="set-row" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "center", padding: "20px 24px" }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15.5 }}>{title}</div>
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
  // Asked for rather than typed, so this and Help > Version cannot drift.
  const [version, setVersion] = useState(null);
  useEffect(() => {
    // channel: "app:version" - input {}, returns the string from app.getVersion().
    if (!window.api || typeof window.api.appVersion !== "function") return;
    let live = true;
    window.api.appVersion()
      .then((v) => { if (live) setVersion(v); })
      .catch((err) => console.error("app:version failed", err));
    return () => { live = false; };
  }, []);

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
  // A swatch that differs only by its fill is six identical buttons to anyone
  // who cannot see it, so each one is named by the colour it actually sets.
  const COLOR_NAME = { "#2fbf87": "Green", "#f0894e": "Orange", "#5b8def": "Blue", "#a87bf0": "Purple", "#e0b84a": "Gold", "#fb5e7e": "Pink" };

  return (
    /* Full width, like every other screen's .fade-in - a fixed maxWidth here
       used to leave Settings' panels stranded short of the others' right
       edge. Individual rows still cap their own prose (the `sub` line below
       tops out at 460px) so a wide window doesn't stretch sentences thin. */
    <div className="fade-in">
      <div className="topbar"><div><div className="page-title">Settings</div><div className="page-sub">Preferences for this household. Everything stays on this device.</div></div></div>

      <div className="section-head"><h2>General</h2></div>
      <div className="panel panel-feature">
        <Setting title="Currency symbol" sub="Shown before every amount across the app.">
          {/* A radiogroup in a segmented tray: the chips share one bordered
              --well strip and the chosen one is the solid accent square. */}
          <div role="radiogroup" aria-label="Currency symbol" style={{ display: "flex", gap: 6, background: "var(--well)", border: "1px solid var(--rule-faint)", borderRadius: 8, padding: 4 }}>
            {CURRENCIES.map(c => {
              const on = s.currency === c;
              return (
                <button key={c} role="radio" aria-checked={on} aria-label={`Use ${c} as the currency symbol`}
                  onClick={() => dispatch({ type: "updateSettings", patch: { currency: c } })}
                  className="num chip-radio" style={{ position: "relative", width: 40, height: 40, fontSize: 14, fontWeight: on ? 700 : 500 }}>
                  {c}
                  {/* The tick rides inside the filled square, in the same ink
                      as the symbol, so the selection reads without asking
                      anyone to compare fills. */}
                  {on && (
                    <span style={{ position: "absolute", top: 3, right: 5, color: "inherit", display: "grid", placeItems: "center" }}>
                      <Icons.check size={10} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Setting>
      </div>

      <div className="section-head"><h2>Appearance</h2></div>
      <div className="panel panel-feature" style={{ padding: "22px 24px" }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Theme</div>
        {/* Each card is painted with the theme it previews, so the fixed
            rgba() borders are deliberate: they have to read on all four
            backgrounds, not on the active theme's. Selection is the accent
            ring plus the ACTIVE caption in the corner - the accent is the one
            colour that is the user's own across every theme. */}
        <div role="radiogroup" aria-label="Theme" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 16 }}>
          {BUDGET_THEMES.map((th) => {
            const on = s.theme === th.id;
            return (
              <button key={th.id} role="radio" aria-checked={on} aria-label={`${th.label} theme`}
                onClick={() => dispatch({ type: "updateSettings", patch: { theme: th.id } })}
                style={{
                  position: "relative", display: "flex", alignItems: "flex-end",
                  minHeight: 96, padding: "12px 14px", borderRadius: "var(--radius-sm)", cursor: "pointer", textAlign: "left",
                  background: th.bg,
                  border: on ? "2px solid var(--accent)" : "1px solid rgba(255,255,255,0.12)",
                  boxShadow: on ? "0 0 16px color-mix(in srgb, var(--accent) 25%, transparent)" : "none",
                  transition: "box-shadow .15s, border-color .15s",
                }}>
                {/* The active card's name is the bright one; the others dim
                    with their whole card, so the eye lands where the ring is. */}
                <span style={{ fontSize: on ? 14.5 : 13.5, fontWeight: on ? 600 : 500, color: on ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)" }}>{th.label}</span>
                {on && (
                  <span style={{ position: "absolute", top: 11, right: 14, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-ink)" }}>Active</span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Accents</div>
          <div role="radiogroup" aria-label="Colour" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {ACCENT_COLORS.map((c) => {
              const on = s.accentColor === c.id;
              return (
                <button key={c.id} role="radio" aria-checked={on} aria-label={`${c.label} colour`}
                  title={c.label}
                  onClick={() => dispatch({ type: "updateSettings", patch: { accentColor: c.id } })}
                  style={{
                    position: "relative", width: 24, height: 24, padding: 0, borderRadius: 99,
                    background: c.accent, cursor: "pointer", display: "grid", placeItems: "center",
                    color: "rgba(0,0,0,0.72)", border: "none",
                    /* A ring with a gap, not a ring flush against the swatch:
                       the moat is the panel's own fill, so the selection reads
                       as a halo around the colour rather than a border on it. */
                    boxShadow: on ? "0 0 0 2px var(--raised), 0 0 0 4px var(--accent)" : "none",
                    transition: "box-shadow .15s",
                  }}>
                  {on && <Icons.check size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="section-head"><h2>Household members</h2></div>
      <div className="panel">
        {s.members.map(m => (
          <div key={m.id} className="set-row" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", padding: "12px 22px", minHeight: 56 }}>
            <Avatar member={m} size={32} />
            <TextInline value={m.name} col="memberName" label="Member name" onCommit={(v) => dispatch({ type: "updateMember", id: m.id, patch: { name: v } })} style={{ fontWeight: 500, fontSize: 14 }} />
            {/* Hover-revealed (.row-actions now also answers inside .set-row):
                six colour dots per member on every resting row was the
                noisiest thing on the screen, and picking a colour is a
                once-a-year act. Keyboard focus reveals them the same way. */}
            <div className="row-actions" style={{ gap: 8 }}>
              <div role="radiogroup" aria-label={`Colour for ${m.name}`} style={{ display: "flex", gap: 5 }}>
                {MEMBER_COLORS.map(c => {
                  const on = m.color === c;
                  return (
                    <button key={c} role="radio" aria-checked={on} aria-label={COLOR_NAME[c] || c}
                      title={COLOR_NAME[c] || c}
                      onClick={() => dispatch({ type: "updateMember", id: m.id, patch: { color: c } })}
                      style={{ width: 20, height: 20, padding: 0, borderRadius: 99, background: c, border: on ? "2px solid var(--ink)" : "2px solid transparent", outline: on ? "1px solid var(--on-ink)" : "none", cursor: "pointer", display: "grid", placeItems: "center", color: "rgba(0,0,0,0.72)" }}>
                      {/* the swatches are fixed hex, not theme tokens, so a dark
                          tick reads on every one of them */}
                      {on && <Icons.check size={11} />}
                    </button>
                  );
                })}
              </div>
              <button className="icon-btn" title={`Remove ${m.name}`} aria-label={`Remove ${m.name}`} disabled={s.members.length <= 1} style={{ opacity: s.members.length <= 1 ? .3 : 1 }} onClick={() => setRemoveMember(m)}><Icons.trash size={16} /></button>
            </div>
          </div>
        ))}
        <div className="set-row" style={{ padding: "12px 18px" }}>
          <button className="btn btn-sm btn-ghost" style={{ color: "var(--muted)" }} onClick={() => dispatch({ type: "addMember", name: "New member", color: MEMBER_COLORS[s.members.length % MEMBER_COLORS.length] })}><Icons.plus size={14} /> Add member</button>
        </div>
      </div>

      <div className="section-head"><h2>Funding accounts</h2></div>
      <div className="panel">
        <div className="set-row" style={{ padding: "12px 22px", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
          {/* Two sentences, no italic. The emphasis on "where" was carrying an
              explanation the reader hadn't asked for yet, and naming Revolut
              dated the copy to one product in one country. */}
          Where money actually sits: a current account, a joint one, a savings pot.
          Each budget item is funded from one of these, and the Wallet then shows who moves what.
        </div>
        {(s.accounts || []).map(a => {
          const owner = s.members.find(m => m.id === a.owner);
          return (
            <div key={a.id} className="set-row" style={{ display: "grid", gridTemplateColumns: "auto 1fr 150px 130px auto", gap: 12, alignItems: "center", padding: "12px 22px" }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, flex: "none", background: hexToSoft(a.color), color: a.color, display: "grid", placeItems: "center" }}>{React.createElement(Icons[ACCT_ICON[a.type] || "coins"], { size: 16 })}</span>
              <TextInline value={a.name} col="accountName" label="Account name" onCommit={(v) => dispatch({ type: "updateAccount", id: a.id, patch: { name: v } })} style={{ fontWeight: 500, fontSize: 14 }} />
              <select value={a.type} aria-label={`Account type for ${a.name}`} onChange={(e) => dispatch({ type: "updateAccount", id: a.id, patch: { type: e.target.value } })} className="btn btn-sm" style={{ paddingRight: 8 }}>
                {Object.entries(ACCT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={a.owner || ""} aria-label={`Who owns ${a.name}`} onChange={(e) => dispatch({ type: "updateAccount", id: a.id, patch: { owner: e.target.value || null } })} className="btn btn-sm" style={{ paddingRight: 8 }}>
                <option value="">Shared</option>
                {s.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <div className="row-actions">
                <button className="icon-btn" title={`Remove ${a.name}`} aria-label={`Remove account ${a.name}`} onClick={() => setRemoveAccount(a)}><Icons.trash size={16} /></button>
              </div>
            </div>
          );
        })}
        <div className="set-row" style={{ padding: "12px 18px" }}>
          <button className="btn btn-sm btn-ghost" style={{ color: "var(--muted)" }} onClick={() => dispatch({ type: "addAccount", name: "New account", color: MEMBER_COLORS[(s.accounts || []).length % MEMBER_COLORS.length], accType: "main" })}><Icons.plus size={14} /> Add account</button>
        </div>
      </div>

      <div className="section-head"><h2>Data &amp; backup</h2></div>
      <div className="panel">
        <Setting title="Manual backup" sub={`Save a snapshot of all your budget data to a file. Last backup: ${s.lastBackup || "never"}.`}>
          <button className="btn btn-primary" onClick={doBackup}><Icons.download size={15} /> Back up now</button>
        </Setting>
        <Setting title="Automatic backups" sub="When the app should quietly save a snapshot for you.">
          <div role="radiogroup" aria-label="Automatic backups" style={{ display: "flex", gap: 4, background: "var(--well)", padding: 4, borderRadius: 10 }}>
            {AUTO.map(([val, label]) => {
              const on = s.autoBackup === val;
              return (
                <button key={val} role="radio" aria-checked={on} onClick={() => dispatch({ type: "updateSettings", patch: { autoBackup: val } })}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: on ? 600 : 500, background: on ? "var(--raised)" : "transparent", color: on ? "var(--ink)" : "var(--muted)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
                  {/* the tick keeps its space when hidden, so choosing an option
                      does not shuffle the other two sideways */}
                  <Icons.check size={12} style={{ flex: "none", visibility: on ? "visible" : "hidden" }} />
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
            if (window.api && typeof window.api.revealDataFolder === "function") {
              try { await window.api.revealDataFolder(); toast("Opening data folder…"); }
              catch (err) { console.error("data:revealFolder failed", err); toast(`Couldn't open the data folder. ${err.message}`, "error"); }
              return;
            }
            toast("Opening the data folder needs the desktop app", "error");
          }}><Icons.folder size={15} /> Open data folder</button>
        </Setting>
      </div>
      <div className="section-head"><h2>Shortcuts</h2></div>
      <ShortcutsSection />

      <div className="section-head"><h2>Updates</h2></div>
      <div className="panel"><UpdateSettings /></div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", margin: "26px 0 10px", color: "var(--faint)", fontSize: 12 }}>
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
