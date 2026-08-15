/* ============================================================
   Accounts - per-item funding account selector + funding plan
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { Avatar, DiffPill, Icons, MiniBar } from './components.jsx';
import { accountTotals, cx, fmt, itemActual, monthLabel, round2, walletSummary } from './lib/index.js';

const ACCT_ICON = { joint: "user", main: "budget", wallet: "coins", savings: "plant" };
const ACCT_TYPE_LABEL = { joint: "Shared", main: "Main account", wallet: "Wallet", savings: "Savings" };

/* Size comes from the caller and the fill is the account's own colour, so both
   stay inline; the box itself is .wallet-dot. */
function AccountDot({ acc, size = 9 }) {
  return <span className="wallet-dot" style={{ width: size, height: size, background: acc ? acc.color : "var(--faint)" }} />;
}

/* compact inline select shown under each item name.
   The real <select> is transparent and covers the chip, so the chip is what a
   focus ring has to be drawn on: the select stays a descendant of .acct-chip
   (which carries :focus-within in the stylesheet) and takes no focus styling
   of its own, which would only paint on the invisible element. */
function AccountSelect({ value, accounts, onChange, label = "Funding account" }) {
  const acc = accounts.find(a => a.id === value);
  return (
    <span className={cx("acct-chip", !acc && "acct-chip-empty")}>
      {acc ? <AccountDot acc={acc} size={8} /> : <span className="wallet-chip-glyph"><Icons.coins size={12} /></span>}
      <span className="acct-chip-name">{acc ? acc.name : "Assign account"}</span>
      <Icons.down size={12} className="wallet-chip-caret" />
      <select value={value || ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label}>
        <option value="">Unassigned</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </span>
  );
}

/* the live funding plan card - a read-out, so it takes no dispatch */
function AccountPanel({ mo, accounts, members, currency }) {
  // ids of the "By account" rows expanded to show their allocations
  const [openAccts, setOpenAccts] = useState(() => new Set());
  const toggleAcct = (id) => setOpenAccts(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
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

  // savings wallets - each item in the savings group is a "wallet" of the (single) savings account
  const savingsAccount = accounts.find(a => a.type === "savings");
  const savingsItems = [];
  mo.groups.filter(g => g.isSavings).forEach(g => g.items.forEach(it => {
    if (it.allocated > 0 || itemActual(it) > 0) savingsItems.push({ id: it.id, name: it.name, allocated: it.allocated, actual: itemActual(it) });
  }));
  const savingsTotal = round2(savingsItems.reduce((a, it) => a + it.allocated, 0));

  // "By account" order: group by owner (in member order), joint/shared accounts last.
  // Savings accounts are excluded - they get their own per-wallet breakdown below.
  const ownerRank = owner => { const i = members.findIndex(m => m.id === owner); return i < 0 ? members.length : i; };
  const byAccount = assigned.filter(t => t.account.type !== "savings").sort((a, b) => {
    const ao = a.account.owner, bo = b.account.owner;
    if (!ao !== !bo) return ao ? -1 : 1;
    return ownerRank(ao) - ownerRank(bo);
  });

  return (
    <div className="fade-in">
      {/* per-person "who moves what" */}
      <div className="eyebrow wallet-eyebrow">Who moves what</div>
      <div className="wallet-movers">
        {perPerson.map(p => (
          <div key={p.member.id} className="wallet-mover" style={{ boxShadow: `inset 4px 0 0 0 ${p.member.color || "var(--accent)"}` }}>
            <Avatar member={p.member} size={30} />
            <div className="wallet-grow">
              <div className="wallet-mover-name">{p.member.name} total</div>
              <div className="wallet-mover-sub truncate">into {p.accts.map(t => t.account.name).join(" · ")}</div>
            </div>
            <div className="num wallet-mover-amt">{fmt(currency, p.amount)}</div>
          </div>
        ))}
        {shared.length > 0 && (
          <div className="wallet-mover is-shared">
            <span className="wallet-shared-icon"><Icons.user size={16} /></span>
            <div className="wallet-grow">
              <div className="wallet-mover-name">Shared total</div>
              <div className="wallet-mover-sub truncate">into {shared.map(t => t.account.name).join(" · ")}</div>
            </div>
            <div className="num wallet-mover-amt">{fmt(currency, sharedAmt, { cents: false })}</div>
          </div>
        )}
      </div>

      {/* per-account breakdown */}
      <div className="eyebrow wallet-eyebrow">By account</div>
      <div className="panel panel-clip">
        {byAccount.map((t, i) => {
          const owner = members.find(m => m.id === t.account.owner);
          const pct = totalToFund > 0 ? t.allocated / totalToFund : 0;
          const Icon = Icons[ACCT_ICON[t.account.type] || "coins"];
          const canOpen = t.items.length > 0;
          const open = openAccts.has(t.account.id);
          const listId = `acct-items-${t.account.id}`;
          const tint = owner ? `color-mix(in srgb, ${owner.color} 3%, var(--board))` : `color-mix(in srgb, var(--info) 3%, var(--board))`;
          return (
            <div key={t.account.id} className={cx("wallet-acct", i && "is-divided")}>
              <button className="acct-row wallet-acct-row" onClick={canOpen ? () => toggleAcct(t.account.id) : undefined} disabled={!canOpen}
                aria-expanded={canOpen ? open : undefined} aria-controls={canOpen ? listId : undefined}
                title={canOpen ? (open ? "Hide allocations" : "Show allocations") : undefined}
                style={{ background: tint }}>
                <span className="wallet-tile" style={{ background: hexToSoft(t.account.color), color: t.account.color }}><Icon size={17} /></span>
                <div className="wallet-grow">
                  <div className="wallet-acct-title">{t.account.name}
                    {owner ? <span className="pill pill-neutral wallet-owner-pill">{owner.name}</span> : <span className="pill pill-neutral wallet-owner-pill">{ACCT_TYPE_LABEL[t.account.type] || "Shared"}</span>}
                  </div>
                  {/* The pill only appears when the account is over: the item
                      rows carry one permanently, but a "on track" pill on every
                      row here would bury the one row that is not. */}
                  <div className="wallet-acct-meta">
                    <span className="wallet-fixed">{t.count} item{t.count !== 1 ? "s" : ""}</span>
                    <span className="wallet-meta-bar"><MiniBar actual={t.actual} allocated={t.allocated} /></span>
                    <span className="num wallet-fixed">{fmt(currency, t.actual, { cents: false })} spent</span>
                    {t.actual > t.allocated + 0.001 && <DiffPill diff={round2(t.allocated - t.actual)} currency={currency} />}
                  </div>
                </div>
                {canOpen && <Icons.down size={16} className={cx("wallet-caret", open && "is-open")} />}
                <div className="wallet-acct-figs">
                  <div className="num wallet-figure">{fmt(currency, t.allocated)}</div>
                  <div className="num wallet-acct-pct">{Math.round(pct * 100)}% of plan</div>
                </div>
              </button>
              {canOpen && open && (
                <div id={listId} className="fade-in wallet-acct-items" style={{ boxShadow: `inset 3px 0 0 0 ${t.account.color}` }}>
                  {t.items.map((it, j) => (
                    <div key={it.id} className={cx("wallet-alloc", j && "is-divided")}>
                      <div className="wallet-grow">
                        <div className="wallet-alloc-name truncate">{it.name}</div>
                        <div className="wallet-alloc-meta">
                          <span className="wallet-alloc-group truncate">{it.group}</span>
                          <span className="wallet-alloc-bar"><MiniBar actual={it.actual} allocated={it.allocated} /></span>
                          <span className="num wallet-fixed">{fmt(currency, it.actual, { cents: false })} spent</span>
                        </div>
                      </div>
                      <div className="num wallet-alloc-amt">{fmt(currency, it.allocated)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* savings wallets - breakdown of the savings group into the savings account's wallets */}
      {savingsItems.length > 0 && (
        <>
          <div className="eyebrow wallet-eyebrow wallet-savings-head">
            <span>{savingsAccount ? savingsAccount.name : "Savings"} wallets</span>
            <span className="num wallet-savings-total">{fmt(currency, savingsTotal)}</span>
          </div>
          <div className="panel panel-clip">
            {savingsItems.map((it, i) => {
              // A savings icon in the app's default green used to be a small
              // "you're doing well" nudge; the same reasoning that retired the
              // old positive token elsewhere applies here, so an account with
              // no colour of its own falls back to the neutral avatar tint.
              const color = savingsAccount ? savingsAccount.color : "var(--muted)";
              return (
                <div key={it.id} className={cx("wallet-savings-row", i && "is-divided")}>
                  {/* Neutral pairing to match the icon colour above: #96a1b4 is
                      --muted resolved to a literal hex (hexToSoft only takes one,
                      it can't read a CSS var), so a savings wallet with no account
                      colour of its own gets a grey tint under a grey icon rather
                      than the old green tint under a now-grey icon. */}
                  <span className="wallet-tile" style={{ background: hexToSoft(savingsAccount ? savingsAccount.color : "#96a1b4"), color }}><Icons.plant size={17} /></span>
                  <div className="wallet-grow">
                    <div className="wallet-savings-name">{it.name}</div>
                    <div className="wallet-acct-meta">
                      <span className="wallet-meta-bar"><MiniBar actual={it.actual} allocated={it.allocated} /></span>
                      <span className="num wallet-fixed">{fmt(currency, it.actual, { cents: false })} moved</span>
                      {it.actual > it.allocated + 0.001 && <DiffPill diff={round2(it.allocated - it.actual)} currency={currency} />}
                    </div>
                  </div>
                  <div className="num wallet-savings-amt">{fmt(currency, it.allocated)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {unassigned && (
        <div className="wallet-unassigned">
          <Icons.alert size={16} />
          <span className="wallet-unassigned-text">{fmt(currency, unassigned.allocated, { cents: false })} across {unassigned.count} item{unassigned.count !== 1 ? "s" : ""} isn't assigned to an account yet.</span>
        </div>
      )}
    </div>
  );
}

function hexToSoft(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.20)`;
}

/* the Wallet drawer - slide-over holding the panel.

   The veil stops the mouse reaching the budget behind it, so the keyboard must
   not be able to either: this is the same trap, initial focus and focus
   restore that Modal does in components.jsx, applied to a drawer rather than
   invented a second time. */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function WalletDrawer({ mo, accounts, members, currency, month, onClose }) {
  const boxRef = useRef(null);
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !boxRef.current) return;
      const items = Array.from(boxRef.current.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  // Move focus in on open, put it back on the Wallet button on close.
  useEffect(() => {
    const returnTo = document.activeElement;
    const box = boxRef.current;
    const target = box && box.querySelector(FOCUSABLE);
    if (target) target.focus();
    return () => { if (returnTo && typeof returnTo.focus === "function") returnTo.focus(); };
  }, []);
  const { toFund, hasUnassigned } = walletSummary(mo, accounts);
  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside ref={boxRef} className="drawer" role="dialog" aria-modal="true" aria-label="Wallet">
        <div className="drawer-head">
          <div className="wallet-head-id">
            <span className="wallet-head-mark"><Icons.wallet size={19} /></span>
            <div>
              <div className="wallet-head-title">Wallet</div>
              <div className="wallet-head-sub"> Movements for {monthLabel(month).mo}</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close the Wallet" title="Close"><Icons.x size={18} /></button>
        </div>
        <div className="wallet-total">
          <div className="wallet-total-label">Total to move this month</div>
          <span className="num wallet-total-figure">{fmt(currency, toFund)}</span>
        </div>
        <div className="drawer-body">
          <AccountPanel mo={mo} accounts={accounts} members={members} currency={currency} />
        </div>
      </aside>
    </>
  );
}

export { AccountSelect, AccountPanel, WalletDrawer, AccountDot, ACCT_TYPE_LABEL, ACCT_ICON, hexToSoft };
