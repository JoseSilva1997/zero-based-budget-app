/* ============================================================
   Accounts — per-item funding account selector + funding plan
   ============================================================ */
const ACCT_ICON = { joint: "user", main: "budget", wallet: "coins", savings: "plant" };
const ACCT_TYPE_LABEL = { joint: "Shared", main: "Main account", wallet: "Wallet", savings: "Savings" };

function AccountDot({ acc, size = 9 }) {
  return <span style={{ width: size, height: size, borderRadius: 3, background: acc ? acc.color : "var(--faint)", flex: "none", display: "inline-block" }} />;
}

/* compact inline select shown under each item name */
function AccountSelect({ value, accounts, onChange }) {
  const acc = accounts.find(a => a.id === value);
  return (
    <span className={`acct-chip ${acc ? "" : "acct-chip-empty"}`}>
      {acc ? <AccountDot acc={acc} size={8} /> : <span style={{ display: "inline-flex" }}><Icons.coins size={12} /></span>}
      <span className="acct-chip-name">{acc ? acc.name : "Assign account"}</span>
      <Icons.down size={12} style={{ opacity: 0.5, marginLeft: -2 }} />
      <select value={value || ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Funding account">
        <option value="">Unassigned</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </span>
  );
}

/* the live funding plan card */
function AccountPanel({ mo, accounts, members, currency, dispatch, month }) {
  const totals = accountTotals(mo, accounts);
  const assigned = totals.filter(t => t.account);
  const unassigned = totals.find(t => !t.account);
  const totalToFund = round2(assigned.reduce((a, t) => a + t.allocated, 0));

  // per-person rollup
  const perPerson = members.map(m => ({
    member: m,
    amount: round2(assigned.filter(t => t.account.owner === m.id).reduce((a, t) => a + t.allocated, 0)),
    accts: assigned.filter(t => t.account.owner === m.id),
  })).filter(p => p.accts.length > 0);
  const shared = assigned.filter(t => !t.account.owner);
  const sharedAmt = round2(shared.reduce((a, t) => a + t.allocated, 0));

  // savings wallets — each item in the savings group is a "wallet" of the (single) savings account
  const savingsAccount = accounts.find(a => a.type === "savings");
  const savingsItems = [];
  mo.groups.filter(g => g.isSavings).forEach(g => g.items.forEach(it => {
    if (it.allocated > 0 || itemActual(it) > 0) savingsItems.push({ id: it.id, name: it.name, allocated: it.allocated, actual: itemActual(it) });
  }));
  const savingsTotal = round2(savingsItems.reduce((a, it) => a + it.allocated, 0));

  // "By account" order: group by owner (in member order), joint/shared accounts last.
  // Savings accounts are excluded — they get their own per-wallet breakdown below.
  const ownerRank = owner => { const i = members.findIndex(m => m.id === owner); return i < 0 ? members.length : i; };
  const byAccount = assigned.filter(t => t.account.type !== "savings").sort((a, b) => {
    const ao = a.account.owner, bo = b.account.owner;
    if (!ao !== !bo) return ao ? -1 : 1;
    return ownerRank(ao) - ownerRank(bo);
  });

  return (
    <div className="fade-in">
      {/* per-person "who moves what" */}
      <div style={{ fontSize: 11, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>Who moves what</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {perPerson.map(p => (
          <div key={p.member.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderRadius: 11, background: "var(--surface-sunken)", border: "1px solid var(--border-strong)", boxShadow: `inset 4px 0 0 0 ${p.member.color || "var(--accent)"}` }}>
            <Avatar member={p.member} size={30} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.member.name} total</div>
              <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>into {p.accts.map(t => t.account.name).join(" · ")}</div>
            </div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 600, flex: "none" }}>{fmt(currency, p.amount)}</div>
          </div>
        ))}
        {shared.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderRadius: 11, background: "var(--surface-sunken)", border: "1px solid var(--border-strong)", boxShadow: "inset 4px 0 0 0 var(--info)" }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--info-soft)", color: "var(--info)", display: "grid", placeItems: "center", flex: "none" }}><Icons.user size={16} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Shared total</div>
              <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>into {shared.map(t => t.account.name).join(" · ")}</div>
            </div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 600, flex: "none" }}>{fmt(currency, sharedAmt, { cents: false })}</div>
          </div>
        )}
      </div>

      {/* per-account breakdown */}
      <div style={{ fontSize: 11, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>By account</div>
      <div className="card" style={{ overflow: "hidden", background: "var(--surface-2)" }}>
        {byAccount.map((t, i) => {
          const owner = members.find(m => m.id === t.account.owner);
          const pct = totalToFund > 0 ? t.allocated / totalToFund : 0;
          const Icon = Icons[ACCT_ICON[t.account.type] || "coins"];
          return (
            <div key={t.account.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 15px", borderTop: i ? "1px solid var(--border)" : "none", background: owner ? `color-mix(in srgb, ${owner.color} 3%, var(--surface-2))` : `color-mix(in srgb, var(--info) 3%, var(--surface-2))` }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, flex: "none", background: hexToSoft(t.account.color), color: t.account.color, display: "grid", placeItems: "center" }}><Icon size={17} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 7 }}>{t.account.name}
                  {owner ? <span className="pill pill-neutral" style={{ fontSize: 10 }}>{owner.name}</span> : <span className="pill pill-neutral" style={{ fontSize: 10 }}>{ACCT_TYPE_LABEL[t.account.type] || "Shared"}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: "none" }}>{t.count} item{t.count !== 1 ? "s" : ""}</span>
                  <span style={{ flex: 1, maxWidth: 90 }}><MiniBar actual={t.actual} allocated={t.allocated} /></span>
                  <span className="mono" style={{ flex: "none" }}>{fmt(currency, t.actual, { cents: false })} spent</span>
                </div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <div className="mono" style={{ fontSize: 15.5, fontWeight: 600 }}>{fmt(currency, t.allocated)}</div>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>{Math.round(pct * 100)}% of plan</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* savings wallets — breakdown of the savings group into the savings account's wallets */}
      {savingsItems.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10, marginTop: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{savingsAccount ? savingsAccount.name : "Savings"} wallets</span>
            <span className="mono" style={{ color: "var(--faint)", letterSpacing: 0 }}>{fmt(currency, savingsTotal)}</span>
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {savingsItems.map((it, i) => {
              const color = savingsAccount ? savingsAccount.color : "var(--accent)";
              return (
                <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 15px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, flex: "none", background: hexToSoft(savingsAccount ? savingsAccount.color : "#2dd4a8"), color, display: "grid", placeItems: "center" }}><Icons.plant size={17} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{it.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, maxWidth: 90 }}><MiniBar actual={it.actual} allocated={it.allocated} /></span>
                      <span className="mono" style={{ flex: "none" }}>{fmt(currency, it.actual, { cents: false })} moved</span>
                    </div>
                  </div>
                  <div className="mono" style={{ textAlign: "right", flex: "none", fontSize: 15.5, fontWeight: 600 }}>{fmt(currency, it.allocated)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {unassigned && (
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 15px", borderRadius: 11, marginTop: 14, background: "var(--neg-soft)", color: "var(--neg-ink)" }}>
          <Icons.alert size={16} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{fmt(currency, unassigned.allocated, { cents: false })} across {unassigned.count} item{unassigned.count !== 1 ? "s" : ""} isn't assigned to an account yet.</span>
        </div>
      )}
    </div>
  );
}

/* lightweight summary for the Wallet trigger button */
function walletSummary(mo, accounts) {
  const totals = accountTotals(mo, accounts);
  const toFund = round2(totals.filter(t => t.account).reduce((a, t) => a + t.allocated, 0));
  const unassigned = totals.find(t => !t.account);
  return { toFund, hasUnassigned: !!unassigned, unassignedAmt: unassigned ? unassigned.allocated : 0 };
}

function hexToSoft(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.20)`;
}

/* the Wallet drawer — slide-over holding the panel */
function WalletDrawer({ mo, accounts, members, currency, dispatch, month, onClose }) {
  useEffect(() => { const h = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  const { toFund, hasUnassigned } = walletSummary(mo, accounts);
  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Wallet">
        <div className="drawer-head">
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(150deg, var(--accent), var(--accent-strong))", color: "var(--on-accent)", display: "grid", placeItems: "center", boxShadow: "var(--glow-sm), inset 0 1px 0 color-mix(in srgb, #fff 22%, transparent)", flex: "none" }}><Icons.wallet size={19} /></span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Wallet</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}> Movements for {monthLabel(month).mo}</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close"><Icons.x size={18} /></button>
        </div>
        <div style={{ padding: "16px 22px 18px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--accent) 8%, var(--surface-2))" }}>
          <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500, marginBottom: 6 }}>Total to move this month</div>
          <span className="mono" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.025em", color: "var(--ink)" }}>{fmt(currency, toFund)}</span>
        </div>
        <div className="drawer-body">
          <AccountPanel mo={mo} accounts={accounts} members={members} currency={currency} dispatch={dispatch} month={month} />
        </div>
      </aside>
    </>
  );
}

Object.assign(window, { AccountSelect, AccountPanel, WalletDrawer, walletSummary, AccountDot, ACCT_TYPE_LABEL, ACCT_ICON, hexToSoft });
