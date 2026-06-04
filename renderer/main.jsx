/* ============================================================
   App shell — nav, theme, month budget composition, tweaks
   ============================================================ */

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
          <button className="btn wallet-btn" onClick={() => setWalletOpen(true)} title="Open Wallet — funding plan by account">
            <Icons.wallet size={16} />
            Wallet
            <span className="wallet-amt">{fmt(currency, wallet.toFund, { cents: false })}</span>
            {wallet.hasUnassigned && <span className="wallet-warn" title="Some allocations aren't assigned to an account" />}
          </button>
          <button className="btn" onClick={() => window.__openNewMonth()}><Icons.plus size={16} /> New month</button>
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

      {mo.groups.map((g, i) => (
        <GroupCard key={g.id} group={g} currency={currency} dispatch={dispatch} month={mid} accounts={state.settings.accounts} isFirst={i === 0} isLast={i === mo.groups.length - 1} />
      ))}

      {mo.groups.length === 0 && (
        <div className="card empty" style={{ marginBottom: 14 }}>
          <div className="empty-icon"><Icons.budget size={22} /></div>
          <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>No groups yet</div>
          <div style={{ fontSize: 13, maxWidth: 300 }}>Add a group like House, Food, or Savings, then give it items to allocate toward.</div>
        </div>
      )}

      {addingGroup ? (
        <div className="card" style={{ display: "flex", gap: 8, padding: "12px 16px", alignItems: "center" }}>
          <input autoFocus className="tinput" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name (e.g. Healthcare)…" style={{ maxWidth: 320, fontWeight: 600 }}
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

/* ---- toast -------------------------------------------------------------- */
function Toast({ msg }) {
  if (!msg) return null;
  return <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: "var(--ink)", color: "var(--surface)", padding: "11px 18px", borderRadius: 10, fontSize: 13.5, fontWeight: 500, boxShadow: "var(--shadow-lg)", zIndex: 80, display: "flex", alignItems: "center", gap: 9, animation: "pop .2s ease" }}><Icons.check size={16} style={{ color: "var(--accent)" }} /> {msg}</div>;
}

/* ---- theme picker (12 dark themes) -------------------------------------- */
function ThemePicker({ value, onChange }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
      {BUDGET_THEMES.map((th) => {
        const on = th.id === value;
        return (
          <button key={th.id} type="button" title={th.label} onClick={() => onChange(th.id)}
            style={{
              position: "relative", display: "flex", alignItems: "center", gap: 6,
              padding: "7px 8px", borderRadius: 9, cursor: "pointer", overflow: "hidden",
              background: th.bg,
              border: on ? `1px solid ${th.accent}` : "1px solid rgba(255,255,255,0.12)",
              boxShadow: on ? `0 0 0 2px ${th.accent}66, 0 5px 14px -4px ${th.accent}88` : "none",
              transition: "box-shadow .15s, border-color .15s",
            }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, flex: "none", background: th.accent, boxShadow: `0 0 8px ${th.accent}aa` }} />
            <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.01em", color: "rgba(255,255,255,0.85)" }}>{th.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- app ---------------------------------------------------------------- */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "indigo",
  "density": "comfortable"
}/*EDITMODE-END*/;

function App() {
  const [state, dispatch] = React.useReducer(reducer, null, () => {
    // channel: "budget:load" — input {}, returns AppState | null (null ⇒ seed).
    const normaliseTheme = (st) => { if (st && st.settings && !THEME_IDS.includes(st.settings.theme)) st.settings.theme = "indigo"; return st; };
    if (window.api && typeof window.api.loadBudget === "function") {
      try {
        const loaded = window.api.loadBudget();
        return loaded ? normaliseTheme(loaded) : buildEmpty();
      } catch (e) { console.error("budget:load failed", e); }
    }
    // Browser fallback (no Electron): localStorage.
    try {
      const saved = localStorage.getItem("housebudget_v3");
      if (saved) return normaliseTheme(JSON.parse(saved));
    } catch {}
    return buildEmpty();
  });
  const [tab, setTab] = useState("budget");
  const [newMonth, setNewMonth] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const toastTimer = useRef(null);
  const toast = useCallback((m) => { setToastMsg(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToastMsg(null), 2600); }, []);

  useEffect(() => { window.__openNewMonth = () => setNewMonth(true); }, []);
  useEffect(() => {
    // channel: "budget:save" — input { state }, returns { ok }.
    if (window.api && typeof window.api.saveBudget === "function") {
      window.api.saveBudget(state).catch((e) => console.error("budget:save failed", e));
      return;
    }
    // Browser fallback (no Electron): localStorage.
    try { localStorage.setItem("housebudget_v3", JSON.stringify(state)); } catch {}
  }, [state]);

  // resolve theme (settings + tweak) — dark-only, 12 named palettes
  const themePref = THEME_IDS.includes(t.theme) ? t.theme : "indigo";
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themePref);
  }, [themePref]);

  // density from tweak
  useEffect(() => { document.documentElement.setAttribute("data-density", t.density === "compact" ? "compact" : "comfortable"); }, [t.density]);

  // keep settings theme in sync when changed in Settings screen
  useEffect(() => { if (state.settings.theme !== t.theme && THEME_IDS.includes(state.settings.theme)) setTweak("theme", state.settings.theme); }, [state.settings.theme]);

  const currency = state.settings.currency;
  const NAV = [["budget", "Month Budget", Icons.budget], ["history", "History", Icons.history], ["settings", "Settings", Icons.settings]];

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
          {tab === "budget" && <MonthBudgetScreen state={state} dispatch={dispatch} currency={currency} />}
          {tab === "history" && <HistoryScreen state={state} dispatch={dispatch} currency={currency} onOpenMonth={(id) => { dispatch({ type: "setActive", id }); setTab("budget"); }} />}
          {tab === "settings" && <SettingsScreen state={state} dispatch={dispatch} currency={currency} toast={toast} />}
        </div>
      </main>

      {newMonth && <NewMonthModal state={state} dispatch={dispatch} onClose={() => setNewMonth(false)} />}
      <Toast msg={toastMsg} />

      <TweaksPanel>
        <TweakSection label="Theme" />
        <ThemePicker value={themePref} onChange={(v) => { setTweak("theme", v); dispatch({ type: "updateSettings", patch: { theme: v } }); }} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={["comfortable", "compact"]} onChange={(v) => setTweak("density", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
