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
  const GroupDropLine = () => <div className="group-drop-line" />;
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
        <div className="topbar-actions">
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

      <div className="section-head allocations-head">
        <h2>Allocations</h2>
        {/* Same grid as the rows below, plus a leading cell for their 26px drag
            handle, so each label sits over the column it names. */}
        <div className="eyebrow budget-colhead">
          <span />
          <span />
          <span className="col-right">Allocated</span>
          <span className="col-actual col-right">Actual</span>
          <span className="col-diff col-right">Difference</span>
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
        <div className="panel empty no-groups">
          <div className="empty-icon"><Icons.budget size={22} /></div>
          <div className="no-groups-title">No groups yet</div>
          <div className="no-groups-hint">Add a group like House, Food, or Savings, then give it items to allocate toward.</div>
        </div>
      )}

      {addingGroup ? (
        <div className="panel new-group-row">
          <input autoFocus className="tinput new-group-input" value={newGroup} aria-label="New group name" onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name (e.g. Healthcare)…"
            onKeyDown={(e) => { if (e.key === "Enter") commitGroup(); if (e.key === "Escape") { setAddingGroup(false); setNewGroup(""); } }} onBlur={commitGroup} />
          <button className="btn btn-sm btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={commitGroup}>Add group</button>
        </div>
      ) : (
        /* Not a full-width dashed slab. A dashed outline the width of the page
           reads as a drop target or a missing card, and it out-weighed every
           real group above it; this is the same quiet "+ Add item" affordance
           each group card already ends with, one level out. */
        <button className="btn btn-ghost btn-quiet add-group-btn" onClick={() => setAddingGroup(true)}><Icons.plus size={16} /> Add group</button>
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
   Success and failure must not look alike, but they are one object in two
   fills rather than two components: the same overlay recipe as the find bar
   and the modal. What separates them is the fill, the alert icon, no
   auto-dismiss, role="alert" so the failure is announced, and the draining
   edge an error does not have.

   'msg.action' is how a one-click delete stays recoverable: the toast that
   reports it also carries the way back, and the longer window an action earns
   is what that edge was drawn to make visible.

   The one value set here is --toast-life, the store's own timeout handed
   across to CSS, so the countdown and the disappearance are the same
   number. */
function Toast({ msg, onDismiss }) {
  if (!msg) return null;
  const isError = msg.tone === "error";
  return (
    // The dock spans the window and centres the toast in it.
    <div className="toast-dock">
      <div
        className={isError ? "toast is-error" : "toast"}
        style={isError ? undefined : { "--toast-life": `${msg.duration}ms` }}
        role={isError ? "alert" : "status"}
        aria-live={isError ? "assertive" : "polite"}>
        {isError && <Icons.alert size={16} className="toast-icon" />}
        <span className="toast-msg">{msg.message}</span>
        {msg.action && (
          <button className="btn btn-sm" onClick={() => { msg.action.onAct(); onDismiss(); }}>
            {msg.action.label}
          </button>
        )}
        {isError && (
          <button className="icon-btn toast-dismiss" onClick={onDismiss} aria-label="Dismiss">
            <Icons.x size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ---- loading shell ------------------------------------------------------ */
function LoadingScreen() {
  return (
    <div role="status" className="loading-screen">
      <div className="loading-screen-inner">
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
    <div className="startup-error">
      <div className="panel startup-error-card">
        <div className="startup-error-icon">
          <Icons.alert size={22} />
        </div>
        <h3 className="startup-error-title">House Budget couldn't open your data</h3>
        <p className="startup-error-body">
          Your budget file is still on this device, and nothing has been changed or deleted. This usually means the app is already running in another window, or the file is being synced by another program.
        </p>
        {/* A driver error string genuinely is code, so it takes the mono
            face. */}
        <p className="code startup-error-detail">
          {error && error.message}
        </p>
        <div className="startup-error-actions">
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

  /* Collapsed the sidebar is a 64px rail of icons, and everything about that
     is CSS: the flag only puts data-panel="rail" on the shell, which overrides
     --sidebar-w and hides the labels. The markup below is the same in both
     states, so there is one sidebar to maintain rather than two, and the
     toast dock (pinned at left: var(--sidebar-w)) follows for free. */
  const railed = state.settings.sidebarCollapsed;
  const toggleRail = () => dispatch({ type: "updateSettings", patch: { sidebarCollapsed: !railed } });

  return (
    <div className={`app ${find.open ? "find-open" : ""}`} data-panel={railed ? "rail" : undefined}>
      <aside className="sidebar" id="sidebar-panel">
        <div className="brand">
          {/* The monogram is the collapse control: it is the one thing that
              keeps its place in both states, so the button never moves out
              from under the cursor that just used it. The heading stays
              outside it - a button may only contain phrasing content, and an
              h1 inside one is invalid. */}
          <button
            type="button"
            className="brand-mark"
            onClick={toggleRail}
            aria-expanded={!railed}
            aria-controls="sidebar-panel"
            aria-label={railed ? "Expand panel" : "Collapse panel"}
            title={railed ? "Expand panel" : "Collapse panel"}
          >
            <span className="brand-mark-hb" aria-hidden="true">HB</span>
            {/* Swapped in on hover, so the tile says what it does without the
                panel carrying a second control for it. */}
            <span className="brand-mark-chev" aria-hidden="true">
              {railed ? <Icons.right size={18} /> : <Icons.left size={18} />}
            </span>
          </button>
          {/* The app title, so the page has a level-one heading. */}
          <div className="brand-text"><h1 className="brand-name">House Budget</h1><div className="brand-sub">Zero-based · local</div></div>
        </div>
        {/* No section label over these four: they sit directly under the app's
            name and need no header. "Household" below labels a list of people,
            not one of the app's own sections, so that one stays. */}
        <nav aria-label="Sections" className="nav-list">
          {NAV.map(([id, label, Ico, IcoFill]) => {
            const on = tab === id;
            const I = on ? IcoFill : Ico;
            return (
              /* aria-label is unconditional rather than only set on the rail:
                 the visible label is hidden in CSS, so the name has to come
                 from somewhere the collapse never touches. title is what
                 gives the rail its hover tooltip. */
              <button key={id} className={`nav-item ${on ? "active" : ""}`} aria-current={on ? "page" : undefined} aria-label={label} title={label} onClick={() => setTab(id)}><I size={20} /> <span className="nav-item-label">{label}</span></button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <UpdateBanner />
          {/* The rule above this group is .household's, not the foot's: an
              update notice is about the app, not about who lives here. */}
          <div className="household">
            <div className="eyebrow nav-label">Household</div>
            {state.settings.members.map(m => (
              <div className="member-chip" key={m.id} title={m.name}><Avatar member={m} size={24} /> <span className="member-chip-name">{m.name}</span></div>
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
      {/* Keyed on the store's counter, not on the message: two identical
          confirmations in a row would otherwise reuse the same DOM node, and
          neither the entrance nor the draining edge would restart. */}
      <Toast key={toastMsg ? toastMsg.id : "none"} msg={toastMsg} onDismiss={dismissToast} />
      {/* Dev only. The test is written inline rather than as an imported IS_DEV
          constant because esbuild only substitutes process.env.NODE_ENV where
          it literally appears: behind an import it stays a runtime binding and
          DebugMenu rides along into the production bundle. Like this it folds
          to `false && …` and the module is tree-shaken out entirely. */}
      {process.env.NODE_ENV === 'development' && <DebugMenu />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StoreProvider>
    <App />
  </StoreProvider>
);
