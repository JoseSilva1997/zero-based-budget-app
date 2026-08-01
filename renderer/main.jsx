/* ============================================================
   App shell - nav, theme, month budget composition, tweaks
   Entry point: esbuild bundles starting here, following the imports below.
   ============================================================ */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { THEME_IDS, fmt, monthLabel, walletSummary } from './lib/index.js';
import { StoreProvider, useStore } from './store.jsx';
import { Avatar, Icons } from './components.jsx';
import { WalletDrawer } from './Accounts.jsx';
import { GroupCard, NewMonthModal } from './MonthGroups.jsx';
import { IncomeSection, SummaryHero } from './MonthBudget.jsx';
import { HistoryScreen } from './History.jsx';
import { DashboardScreen } from './Dashboard.jsx';
import { SettingsScreen } from './Settings.jsx';

function MonthBudgetScreen({ state, dispatch, currency }) {
  const mid = state.activeMonth;
  const mo = state.months[mid];
  const lbl = monthLabel(mid);
  const idx = state.order.indexOf(mid);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
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

  return (
    <div className="fade-in">
      <div className="topbar">
        <div className="month-nav">
          <button className="month-step" disabled={idx <= 0} title="Previous month" onClick={() => dispatch({ type: "setActive", id: state.order[idx - 1] })}><Icons.left size={18} /></button>
          <div className="month-title">
            <span className="yr">{lbl.yr}</span>
            <span className="mo">{lbl.mo}</span>
          </div>
          <button className="month-step" disabled={idx >= state.order.length - 1} title="Next month" onClick={() => dispatch({ type: "setActive", id: state.order[idx + 1] })}><Icons.right size={18} /></button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn wallet-btn" onClick={() => setWalletOpen(true)} title="Open Wallet - funding plan by account">
            <Icons.wallet size={16} />
            Wallet
            <span className="wallet-amt">{fmt(currency, wallet.toFund, { cents: false })}</span>
            {wallet.hasUnassigned && <span className="wallet-warn" title="Some allocations aren't assigned to an account" />}
          </button>
          <button className="btn new-month-btn" onClick={() => window.__openNewMonth()}><Icons.plus size={16} /> New month</button>
        </div>
      </div>

      <SummaryHero mo={mo} currency={currency} />

      <IncomeSection mo={mo} currency={currency} members={state.settings.members} dispatch={dispatch} month={mid} />

      <div className="section-head">
        <h2>Allocations</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--faint)", fontWeight: 600 }}>
          <span style={{ width: 150, textAlign: "right" }}>Allocated</span>
          <span style={{ width: 158, textAlign: "right" }}>Actual</span>
          <span style={{ width: 150, textAlign: "right" }}>Difference</span>
          <span style={{ width: 78 }} />
        </div>
      </div>

      {mo.groups.map((g) => {
        const showLine = dragGroupId && dragGroupId !== g.id && overGroupId === g.id;
        return (
          <React.Fragment key={g.id}>
            {showLine && !overGroupAfter && <GroupDropLine />}
            <GroupCard group={g} currency={currency} dispatch={dispatch} month={mid} accounts={state.settings.accounts} state={state}
              isDragging={dragGroupId === g.id}
              onDragStart={() => setDragGroupId(g.id)}
              onDragOverGroup={(after) => { if (dragGroupId) { setOverGroupId(g.id); setOverGroupAfter(after); } }}
              onDrop={() => dropGroup(g.id)}
              onDragEnd={endGroupDrag} />
            {showLine && overGroupAfter && <GroupDropLine />}
          </React.Fragment>
        );
      })}

      {mo.groups.length === 0 && (
        <div className="card empty" style={{ marginBottom: 14 }}>
          <div className="empty-icon"><Icons.budget size={22} /></div>
          <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>No groups yet</div>
          <div style={{ fontSize: 13, maxWidth: 300 }}>Add a group like House, Food, or Savings, then give it items to allocate toward.</div>
        </div>
      )}

      {addingGroup ? (
        <div className="card" style={{ display: "flex", gap: 8, padding: "12px 16px", alignItems: "center" }}>
          <input autoFocus className="tinput" value={newGroup} aria-label="New group name" onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name (e.g. Healthcare)…" style={{ maxWidth: 320, fontWeight: 600 }}
            onKeyDown={(e) => { if (e.key === "Enter") commitGroup(); if (e.key === "Escape") { setAddingGroup(false); setNewGroup(""); } }} onBlur={commitGroup} />
          <button className="btn btn-sm btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={commitGroup}>Add group</button>
        </div>
      ) : (
        <button className="btn" style={{ width: "100%", justifyContent: "center", borderStyle: "dashed", background: "transparent", color: "var(--muted)" }} onClick={() => setAddingGroup(true)}><Icons.plus size={16} /> Add group</button>
      )}

      {walletOpen && <WalletDrawer mo={mo} accounts={state.settings.accounts} members={state.settings.members} currency={currency} dispatch={dispatch} month={mid} onClose={() => setWalletOpen(false)} />}
    </div>
  );
}

/* ---- toast --------------------------------------------------------------
   Success and failure must not look alike. Errors get their own colour, an
   alert icon, no auto-dismiss, and role="alert" so they are announced. */
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
        background: isError ? "var(--neg-soft)" : "var(--ink)",
        color: isError ? "var(--neg-ink)" : "var(--surface)",
        border: isError ? "1px solid var(--neg)" : "1px solid transparent",
        padding: isError ? "11px 12px 11px 16px" : "11px 18px",
        borderRadius: 10, fontSize: 13.5, fontWeight: 500, lineHeight: 1.45,
        boxShadow: "var(--shadow-lg)", zIndex: 80,
        display: "flex", alignItems: "flex-start", gap: 10, animation: "pop .2s ease",
      }}>
      {isError
        ? <Icons.alert size={16} style={{ flex: "none", marginTop: 1 }} />
        : <Icons.check size={16} style={{ color: "var(--pos)", flex: "none", marginTop: 1 }} />}
      <span style={{ minWidth: 0 }}>{msg.message}</span>
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
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div className="brand-mark"><Icons.plant size={22} /></div>
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
      <div className="card" style={{ maxWidth: 480, padding: "30px 32px" }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: "var(--neg-soft)", color: "var(--neg-ink)", display: "grid", placeItems: "center", marginBottom: 18 }}>
          <Icons.alert size={22} />
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em" }}>House Budget couldn't open your data</h3>
        <p style={{ margin: "0 0 6px", color: "var(--ink-2)", fontSize: 14, lineHeight: 1.55 }}>
          Your budget file is still on this device, and nothing has been changed or deleted. This usually means the app is already running in another window, or the file is being synced by another program.
        </p>
        <p className="mono" style={{ margin: "0 0 22px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5, wordBreak: "break-word" }}>
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
  const { state, loading, error, fatal, retry, dispatch } = useStore();
  const [tab, setTab] = useState("dashboard");
  const [newMonth, setNewMonth] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);
  // Menu handlers are registered once; they read live state through this ref
  // rather than re-subscribing on every store change.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  // Errors stay until dismissed; a message you can miss is a message that
  // lets a failed write read as a success.
  const toast = useCallback((message, tone = "success") => {
    setToastMsg({ message, tone });
    clearTimeout(toastTimer.current);
    if (tone !== "error") toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  useEffect(() => { window.__openNewMonth = () => setNewMonth(true); }, []);

  // Application-menu accelerators. The menu owns discoverability; this owns
  // the behaviour, because the state these commands change lives here.
  useEffect(() => {
    if (!window.api || typeof window.api.onMenuCommand !== "function") return;
    return window.api.onMenuCommand((command) => {
      switch (command) {
        case "newMonth": setNewMonth(true); break;
        case "goDashboard": setTab("dashboard"); break;
        case "goBudget": setTab("budget"); break;
        case "goHistory": setTab("history"); break;
        case "goSettings": setTab("settings"); break;
        case "backupNow": setTab("settings"); break;
        case "prevMonth": case "nextMonth": {
          const s = stateRef.current;
          if (!s) break;
          const i = s.order.indexOf(s.activeMonth) + (command === "nextMonth" ? 1 : -1);
          if (i >= 0 && i < s.order.length) { dispatch({ type: "setActive", id: s.order[i] }); setTab("budget"); }
          break;
        }
        default: break;
      }
    });
  }, [dispatch]);
  // Surface store/IPC failures (e.g. removing a member still referenced) as toasts.
  useEffect(() => { if (error) toast(error.message, "error"); }, [error, toast]);

  // resolve theme from settings - dark-only, 12 named palettes
  const themePref = state && THEME_IDS.includes(state.settings.theme) ? state.settings.theme : "indigo";
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themePref);
  }, [themePref]);

  if (fatal && !state) return <StartupErrorScreen error={fatal} onRetry={retry} />;
  if (loading || !state) return <LoadingScreen />;

  const currency = state.settings.currency;
  const NAV = [["dashboard", "Dashboard", Icons.monitor], ["budget", "Month Budget", Icons.budget], ["history", "History", Icons.history], ["settings", "Settings", Icons.settings]];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icons.plant size={20} /></div>
          <div><div className="brand-name">House Budget</div><div className="brand-sub">Zero-based · local</div></div>
        </div>
        <div className="nav-label">Workspace</div>
        {NAV.map(([id, label, Ico]) => (
          <button key={id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}><Ico size={18} /> {label}</button>
        ))}
        <div className="sidebar-foot">
          <div className="nav-label" style={{ paddingLeft: 10 }}>Household</div>
          {state.settings.members.map(m => (
            <div className="member-chip" key={m.id}><Avatar member={m} size={24} /> {m.name}</div>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">
          {tab === "dashboard" && <DashboardScreen currency={currency} onOpenMonth={(id) => { dispatch({ type: "setActive", id }); setTab("budget"); }} />}
          {tab === "budget" && <MonthBudgetScreen state={state} dispatch={dispatch} currency={currency} />}
          {tab === "history" && <HistoryScreen currency={currency} onOpenMonth={(id) => { dispatch({ type: "setActive", id }); setTab("budget"); }} />}
          {tab === "settings" && <SettingsScreen state={state} dispatch={dispatch} currency={currency} toast={toast} />}
        </div>
      </main>

      {newMonth && <NewMonthModal dispatch={dispatch} onClose={() => setNewMonth(false)} />}
      <Toast msg={toastMsg} onDismiss={() => setToastMsg(null)} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StoreProvider>
    <App />
  </StoreProvider>
);
