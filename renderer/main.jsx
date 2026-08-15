/* ============================================================
   App shell - nav, theme, month budget composition, tweaks
   Entry point: esbuild bundles starting here, following the imports below.
   ============================================================ */
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { THEME_IDS, DEFAULT_THEME_ID, fmt, monthLabel, walletSummary } from './lib/index.js';
import { StoreProvider, useStore } from './store.jsx';
import { Avatar, ConfirmDialog, Icons, MsIcons } from './components.jsx';
import { WalletDrawer } from './Accounts.jsx';
import { GroupCard, NewMonthModal } from './MonthGroups.jsx';
import { IncomeSection } from './MonthBudget.jsx';
import { MonthBar } from './MonthBar.jsx';
import { QuickEntrySection } from './QuickEntry.jsx';
import { HistoryScreen } from './History.jsx';
import { DashboardScreen } from './Dashboard.jsx';
import { SettingsScreen } from './Settings.jsx';
import { UpdateBanner } from './UpdateBanner.jsx';
import { FindBar } from './Find.jsx';
import { DebugMenu } from './DebugMenu.jsx';

function MonthBudgetScreen({ state, dispatch, currency, onNewMonth }) {
  const mid = state.activeMonth;
  const mo = state.months[mid];
  const lbl = monthLabel(mid);
  const idx = state.order.indexOf(mid);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
  const [confirmMonth, setConfirmMonth] = useState(false);
  // Deleting the last remaining month would leave the budget screen with
  // nothing to show, and the delete needs the desktop bridge to exist at all.
  const canDeleteMonth = state.order.length > 1 && !!window.api && typeof window.api.monthDelete === "function";
  const neighbourMonth = state.order[idx - 1] || state.order[idx + 1];
  const commitGroup = () => { if (newGroup.trim()) dispatch({ type: "addGroup", month: mid, name: newGroup.trim() }); setNewGroup(""); setAddingGroup(false); };
  const wallet = walletSummary(mo, state.settings.accounts);
  const [dragGroupId, setDragGroupId] = useState(null);
  const [overGroupId, setOverGroupId] = useState(null);
  const [overGroupAfter, setOverGroupAfter] = useState(false);
  const endGroupDrag = () => { setDragGroupId(null); setOverGroupId(null); };
  const dropGroup = (targetId) => {
    if (dragGroupId && targetId && dragGroupId !== targetId) dispatch({ type: "reorderGroup", month: mid, groupId: dragGroupId, targetId, after: overGroupAfter });
    endGroupDrag();
  };
  const GroupDropLine = () => <div style={{ height: 3, borderRadius: 999, background: "var(--accent)", margin: "-9px 2px 8px" }} />;
  /* Item drag lives here, not inside a group card, because an item that can
     only be dragged within the card that owns its drag state is an item that
     can never leave its group. */
  const [dragItem, setDragItem] = useState(null);   // { id, groupId }
  const [overItem, setOverItem] = useState(null);   // { groupId, targetId }; null targetId = append
  const endItemDrag = () => { setDragItem(null); setOverItem(null); };

  return (
    <div className="fade-in">
      <div className="topbar">
        <div className="month-nav">
          <button className="month-step" disabled={idx <= 0} aria-label="Previous month" title="Previous month" onClick={() => dispatch({ type: "setActive", id: state.order[idx - 1] })}><Icons.left size={18} /></button>
          <div className="month-title">
            <span className="yr">{lbl.yr}</span>
            <span className="mo">{lbl.mo}</span>
          </div>
          <button className="month-step" disabled={idx >= state.order.length - 1} aria-label="Next month" title="Next month" onClick={() => dispatch({ type: "setActive", id: state.order[idx + 1] })}><Icons.right size={18} /></button>
          {canDeleteMonth && (
            <button className="icon-btn subtle" aria-label={`Delete ${lbl.mo} ${lbl.yr}`} title="Delete this month" onClick={() => setConfirmMonth(true)}><Icons.trash size={15} /></button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn wallet-btn" onClick={() => setWalletOpen(true)} title="Open Wallet - funding plan by account">
            <Icons.wallet size={16} />
            Wallet
            <span className="wallet-amt">{fmt(currency, wallet.toFund, { cents: false })}</span>
            {wallet.hasUnassigned && <span className="wallet-warn" role="img" aria-label="Some allocations aren't assigned to an account" title="Some allocations aren't assigned to an account" />}
          </button>
          <button className="btn btn-primary" onClick={onNewMonth}><Icons.plus size={16} /> New month</button>
        </div>
      </div>

      <MonthBar mo={mo} currency={currency} />

      <IncomeSection mo={mo} currency={currency} members={state.settings.members} dispatch={dispatch} month={mid} />

      <QuickEntrySection mo={mo} month={mid} currency={currency} dispatch={dispatch} />

      {/* Wider than the default section-head gap, and wider than the gap
          Income and Quick entry share above it: this is the page's actual
          work surface, not one more strip of setup, and the break says so
          before a single row of it is on screen. */}
      <div className="section-head" style={{ marginTop: 42 }}>
        <h2>Allocations</h2>
        {/* Same grid as the rows below, plus a leading cell for their 26px drag
            handle, so each label sits over the column it names. The layout
            lives in .budget-colhead now, which is also where "Actual" picks
            up the accent it shares with the month bar's solid fill. */}
        <div className="budget-colhead">
          <span />
          <span />
          <span style={{ textAlign: "right" }}>Allocated</span>
          <span className="col-actual" style={{ textAlign: "right" }}>Actual</span>
          <span className="col-diff" style={{ textAlign: "right" }}>Difference</span>
          <span />
        </div>
      </div>
      {/* Grounds the labels on the table rather than leaving them floating
          over the first card. */}
      <div className="budget-rule" aria-hidden="true" />

      {mo.groups.map((g) => {
        const showLine = dragGroupId && dragGroupId !== g.id && overGroupId === g.id;
        return (
          <React.Fragment key={g.id}>
            {showLine && !overGroupAfter && <GroupDropLine />}
            <GroupCard group={g} currency={currency} dispatch={dispatch} month={mid} accounts={state.settings.accounts} state={state}
              isDragging={dragGroupId === g.id}
              // A row that unmounts mid-drag (rare, but the drag ends outside
              // any listener that could clear it) never fires its own dragend,
              // which would leave the other kind of drag state stuck set and a
              // later drop of this kind misread as the wrong one.
              onDragStart={() => { setDragItem(null); setDragGroupId(g.id); }}
              onDragOverGroup={(after) => { if (dragGroupId) { setOverGroupId(g.id); setOverGroupAfter(after); } }}
              onDrop={() => dropGroup(g.id)}
              onDragEnd={endGroupDrag}
              dragItem={dragItem}
              overItem={overItem}
              onItemDragStart={(groupId, itemId) => { setDragGroupId(null); setDragItem({ id: itemId, groupId }); }}
              onItemDragOver={(groupId, targetId) => { if (dragItem) setOverItem({ groupId, targetId }); }}
              onItemDragEnd={endItemDrag} />
            {showLine && overGroupAfter && <GroupDropLine />}
          </React.Fragment>
        );
      })}

      {mo.groups.length === 0 && (
        <div className="panel empty" style={{ marginBottom: 14 }}>
          <div className="empty-icon"><Icons.budget size={22} /></div>
          <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>No groups yet</div>
          <div style={{ fontSize: 13, maxWidth: 300 }}>Add a group like House, Food, or Savings, then give it items to allocate toward.</div>
        </div>
      )}

      {addingGroup ? (
        <div className="panel" style={{ display: "flex", gap: 8, padding: "12px 16px", alignItems: "center" }}>
          <input autoFocus className="tinput" value={newGroup} aria-label="New group name" onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name (e.g. Healthcare)…" style={{ maxWidth: 320, fontWeight: 600 }}
            onKeyDown={(e) => { if (e.key === "Enter") commitGroup(); if (e.key === "Escape") { setAddingGroup(false); setNewGroup(""); } }} onBlur={commitGroup} />
          <button className="btn btn-sm btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={commitGroup}>Add group</button>
        </div>
      ) : (
        /* Not a full-width dashed slab. A dashed outline the width of the page
           reads as a drop target or a missing card, and it out-weighed every
           real group above it; this is the same quiet "+ Add item" affordance
           each group card already ends with, one level out. */
        <button className="btn btn-ghost" style={{ marginTop: 4, color: "var(--muted)" }} onClick={() => setAddingGroup(true)}><Icons.plus size={16} /> Add group</button>
      )}

      {walletOpen && <WalletDrawer mo={mo} accounts={state.settings.accounts} members={state.settings.members} currency={currency} month={mid} onClose={() => setWalletOpen(false)} />}

      {confirmMonth && (
        <ConfirmDialog title={`Delete ${lbl.mo} ${lbl.yr}?`} width={440}
          confirmLabel="Delete month" icon={<Icons.trash size={15} />}
          onClose={() => setConfirmMonth(false)}
          onConfirm={() => { dispatch({ type: "deleteMonth", id: mid, next: neighbourMonth }); setConfirmMonth(false); }}>
          Only an empty month can go. If this one still has groups or income, delete those first. Other months are not affected.
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ---- toast --------------------------------------------------------------
   Success and failure must not look alike. Errors get their own colour, an
   alert icon, no auto-dismiss, and role="alert" so they are announced.
   'msg.action' is how a one-click delete stays recoverable: the toast that
   reports it also carries the way back. */
function Toast({ msg, onDismiss }) {
  if (!msg) return null;
  const isError = msg.tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      style={{
        position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)",
        maxWidth: "min(560px, calc(100vw - 60px))",
        background: isError ? "var(--breach-soft)" : "var(--ink)",
        color: isError ? "var(--breach-ink)" : "var(--on-ink)",
        border: isError ? "1px solid var(--breach)" : "1px solid transparent",
        padding: isError ? "11px 12px 11px 16px" : "11px 18px",
        borderRadius: 10, fontSize: 13.5, fontWeight: 500, lineHeight: 1.45,
        boxShadow: "var(--shadow-lg)", zIndex: 80,
        display: "flex", alignItems: "flex-start", gap: 10, animation: "pop .2s ease",
      }}>
      {isError
        ? <Icons.alert size={16} style={{ flex: "none", marginTop: 1 }} />
        : <Icons.check size={16} style={{ color: "var(--accent)", flex: "none", marginTop: 1 }} />}
      <span style={{ minWidth: 0 }}>{msg.message}</span>
      {msg.action && (
        // Inherits the toast's own text colour, so it reads at the same
        // contrast as the message it sits beside; the border is decoration.
        <button onClick={() => { msg.action.onAct(); onDismiss(); }}
          style={{ flex: "none", background: "transparent", color: "inherit", font: "inherit", fontWeight: 600, lineHeight: 1.45, textDecoration: "underline", textUnderlineOffset: 2, border: "1px solid color-mix(in srgb, currentColor 40%, transparent)", borderRadius: 7, padding: "0 9px" }}>
          {msg.action.label}
        </button>
      )}
      {isError && (
        <button onClick={onDismiss} aria-label="Dismiss"
          style={{ flex: "none", marginLeft: 4, background: "transparent", border: 0, color: "inherit", opacity: .7, display: "grid", placeItems: "center", padding: 2, borderRadius: 6 }}>
          <Icons.x size={15} />
        </button>
      )}
    </div>
  );
}

/* ---- loading shell ------------------------------------------------------ */
function LoadingScreen() {
  return (
    <div role="status" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div className="brand-mark" aria-hidden="true">HB</div>
        Loading your budget…
      </div>
    </div>
  );
}

/* ---- startup failure ----------------------------------------------------
   The store never came up, so there is no app behind this and no toast to
   show. Name the problem, say the data is still on disk, and offer the three
   things that actually recover it. */
function StartupErrorScreen({ error, onRetry }) {
  const openFolder = async () => {
    if (window.api && typeof window.api.revealDataFolder === "function") {
      try { await window.api.revealDataFolder(); } catch (e) { console.error(e); }
    }
  };
  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 30 }}>
      <div className="panel" style={{ maxWidth: 480, padding: "30px 32px" }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: "var(--breach-soft)", color: "var(--breach-ink)", display: "grid", placeItems: "center", marginBottom: 18 }}>
          <Icons.alert size={22} />
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em" }}>House Budget couldn't open your data</h3>
        <p style={{ margin: "0 0 6px", color: "var(--ink-2)", fontSize: 14, lineHeight: 1.55 }}>
          Your budget file is still on this device, and nothing has been changed or deleted. This usually means the app is already running in another window, or the file is being synced by another program.
        </p>
        {/* A driver error string genuinely is code, so this one keeps the
            mono face that the app's amounts have given up. */}
        <p className="code" style={{ margin: "0 0 22px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5, wordBreak: "break-word" }}>
          {error && error.message}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={onRetry}>Try again</button>
          <button className="btn" onClick={openFolder}><Icons.folder size={15} /> Open data folder</button>
        </div>
      </div>
    </div>
  );
}

/* ---- app ---------------------------------------------------------------- */
function App() {
  const { state, loading, fatal, retry, dispatch, toast, toastMsg, dismissToast } = useStore();
  const [tab, setTab] = useState("dashboard");
  const [newMonth, setNewMonth] = useState(false);
  // find: `token` bumps on every Ctrl+F so an already-open bar re-selects.
  const [find, setFind] = useState({ open: false, token: 0 });
  // Menu handlers are registered once; they read live state through this ref
  // rather than re-subscribing on every store change.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Application-menu accelerators. The menu owns discoverability; this owns
  // the behaviour, because the state these commands change lives here.
  useEffect(() => {
    if (!window.api || typeof window.api.onMenuCommand !== "function") return;
    return window.api.onMenuCommand((command) => {
      switch (command) {
        case "newMonth": setNewMonth(true); break;
        case "openFind": setFind((f) => ({ open: true, token: f.token + 1 })); break;
        case "goDashboard": setTab("dashboard"); break;
        case "goBudget": setTab("budget"); break;
        case "goHistory": setTab("history"); break;
        case "goSettings": setTab("settings"); break;
        case "backupNow": {
          // A backup that reports itself in a toast has no reason to move the
          // user; Settings is only where you go when there is nothing to run.
          if (!window.api || typeof window.api.createBackup !== "function") { setTab("settings"); break; }
          window.api.createBackup()
            .then(() => {
              dispatch({ type: "refreshSettings" }); // pick up the new lastBackup from SQL
              toast("Backup saved to your data folder");
            })
            .catch((err) => { console.error("backup:create failed", err); toast(`Backup failed. ${err.message}`, "error"); });
          break;
        }
        case "prevMonth": case "nextMonth": {
          const s = stateRef.current;
          if (!s) break;
          const i = s.order.indexOf(s.activeMonth) + (command === "nextMonth" ? 1 : -1);
          if (i >= 0 && i < s.order.length) { dispatch({ type: "setActive", id: s.order[i] }); setTab("budget"); }
          break;
        }
        case "checkUpdates":
          window.api.updateCheck().then((s) => {
            if (s.state === "none") toast("You're on the latest version.");
            else if (s.state === "available") toast(`Version ${s.version} is ready to download.`);
            else if (s.state === "downloading") toast(`Downloading version ${s.version}…`);
            else if (s.state === "downloaded") toast(`Version ${s.version} is ready. Restart to install.`);
            else if (s.state === "error") toast(`Couldn't check for updates: ${s.message}`, "error");
            else if (s.state === "checking") toast("Already checking for updates…");
            else toast("Updates aren't available in this build.");
          }).catch((e) => toast(e.message, "error"));
          break;
        default: break;
      }
    });
  }, [dispatch, toast]);

  // The one place a theme is applied: the id from settings goes on <html>, and
  // app.css's [data-theme] block supplies the whole palette from there.
  const themePref = state && THEME_IDS.includes(state.settings.theme) ? state.settings.theme : DEFAULT_THEME_ID;
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themePref);
  }, [themePref]);

  if (fatal && !state) return <StartupErrorScreen error={fatal} onRetry={retry} />;
  if (loading || !state) return <LoadingScreen />;

  const currency = state.settings.currency;
  /* [id, label, outlined icon, filled icon]. The filled variant is what the
     active item shows: Material Symbols carry it as an axis of the same glyph,
     so the shape does not change under the cursor, only its weight. history
     has no filled variant in the family, hence the same component twice. */
  const NAV = [
    ["dashboard", "Dashboard", MsIcons.dashboard, MsIcons.dashboardFill],
    ["budget", "Month Budget", MsIcons.calendar, MsIcons.calendarFill],
    ["history", "History", MsIcons.history, MsIcons.history],
    ["settings", "Settings", MsIcons.settings, MsIcons.settingsFill],
  ];

  return (
    <div className={`app ${find.open ? "find-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">HB</div>
          {/* The app title, so the page has a level-one heading. 'margin: 0'
              only cancels the UA default; the look comes from .brand-name. */}
          <div><h1 className="brand-name" style={{ margin: 0 }}>House Budget</h1><div className="brand-sub">Zero-based · local</div></div>
        </div>
        {/* No section label over these four. "Workspace" was the word a SaaS
            template uses for a tenant, and this is a household's own budget on
            its own machine; four items directly under the app's name need no
            header at all. "Household" below stays, because it labels a list of
            people rather than the app's own sections. */}
        {/* The nav is its own box in the sidebar's column, so it repeats the
            column's gap rather than inheriting it through a fragment. */}
        <nav aria-label="Sections" style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
          {NAV.map(([id, label, Ico, IcoFill]) => {
            const on = tab === id;
            const I = on ? IcoFill : Ico;
            return (
              <button key={id} className={`nav-item ${on ? "active" : ""}`} aria-current={on ? "page" : undefined} onClick={() => setTab(id)}><I size={20} /> {label}</button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <UpdateBanner />
          {/* The rule above this group is .household's, not the foot's: an
              update notice is about the app, not about who lives here. */}
          <div className="household">
            <div className="nav-label">Household</div>
            {state.settings.members.map(m => (
              <div className="member-chip" key={m.id}><Avatar member={m} size={24} /> {m.name}</div>
            ))}
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">
          {tab === "dashboard" && <DashboardScreen currency={currency} onOpenMonth={(id) => { dispatch({ type: "setActive", id }); setTab("budget"); }} />}
          {tab === "budget" && <MonthBudgetScreen state={state} dispatch={dispatch} currency={currency} onNewMonth={() => setNewMonth(true)} />}
          {tab === "history" && <HistoryScreen currency={currency} onOpenMonth={(id) => { dispatch({ type: "setActive", id }); setTab("budget"); }} />}
          {tab === "settings" && <SettingsScreen state={state} dispatch={dispatch} currency={currency} toast={toast} />}
        </div>
      </main>

      {find.open && <FindBar focusToken={find.token} onClose={() => setFind((f) => ({ ...f, open: false }))} />}

      {newMonth && <NewMonthModal dispatch={dispatch} onClose={() => setNewMonth(false)} />}
      <Toast msg={toastMsg} onDismiss={dismissToast} />
      {/* Dev only. The test is written inline, not as an imported IS_DEV
          constant, because esbuild only substitutes process.env.NODE_ENV where
          it literally appears: behind an import it stayed a runtime binding and
          the whole DebugMenu module rode along into the production bundle. Like
          this it folds to `false && …`, the reference disappears, and the module
          is tree-shaken out entirely. Verified by grepping renderer/dist/app.js. */}
      {process.env.NODE_ENV === 'development' && <DebugMenu />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StoreProvider>
    <App />
  </StoreProvider>
);
