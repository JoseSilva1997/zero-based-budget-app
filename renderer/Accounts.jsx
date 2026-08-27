/* ============================================================
   Accounts - per-item funding account selector + funding plan
   ============================================================ */
import { useRef, useState } from 'react';
import { Avatar, DiffPill, EmptyState, Icons, MiniBar, ObjectRow, Stat, Tile, useFocusTrap } from './ui/index.js';
import { cx, fmt, monthLabel, round2, walletPlan, walletSummary } from './lib/index.js';

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

/* ---- one wallet in the grid ---------------------------------------------
   An account drawn as the app's wallet silhouette: a card with a
   semicircular cut in its bottom edge and a slot broken through the hairline
   beside it (docs/wallet.svg; .wallet-card carries the geometry). It is a
   button, because choosing a wallet is what opens it on the right. */
function WalletCard({ t, currency, selected, onSelect }) {
  const Icon = Icons[ACCT_ICON[t.account.type] || "coins"];
  return (
    <button type="button" className={cx("wallet-card", selected && "is-selected")}
      onClick={onSelect} aria-pressed={selected}>
      <Tile icon={Icon} tint={t.account.color} />
      <span className="wallet-card-id">
        <span className="wallet-card-name truncate">{t.account.name}</span>
        <span className="num wallet-card-figure">{fmt(currency, t.allocated)}</span>
      </span>
      <span className="wallet-card-notch" aria-hidden="true" />
    </button>
  );
}

/* ---- the selected wallet, opened out -------------------------------------
   What one account is funding this month: its share of the plan as a bar,
   then the items themselves. The pill beside the name says whose account it
   is, and the difference chip replaces the percentage only when the account
   is over - a row of "on track" chips would bury the one account that is. */
function WalletDetail({ t, members, currency, onClose }) {
  const owner = members.find(m => m.id === t.account.owner);
  const pct = t.allocated > 0 ? Math.round(Math.min(t.actual / t.allocated, 1) * 100) : 0;
  const over = t.actual > t.allocated + 0.001;
  return (
    <div className="panel wallet-detail">
      <div className="wallet-detail-head">
        <div className="wallet-detail-id">
          <div className="wallet-detail-title truncate">{t.account.name}</div>
          <div className="wallet-detail-sub">{t.count} item{t.count !== 1 ? "s" : ""} this month</div>
        </div>
        <span className="pill pill-neutral wallet-owner-pill">{owner ? owner.name : (ACCT_TYPE_LABEL[t.account.type] || "Shared")}</span>
      </div>

      {t.items.length === 0
        ? <div className="wallet-detail-empty">Nothing is assigned to this account yet.</div>
        : t.items.map((it, i) => (
          <ObjectRow key={it.id} size="sm" className={cx("wallet-alloc", i && "is-divided")}
            name={it.name}
            meta={<>
              <span className="wallet-alloc-group truncate">{it.group}</span>
              <span className="wallet-alloc-bar"><MiniBar actual={it.actual} allocated={it.allocated} /></span>
              <span className="num wallet-fixed">{fmt(currency, it.actual, { cents: false })} spent</span>
            </>}
            figure={fmt(currency, it.allocated)} />
        ))}
    </div>
  );
}

/* the live funding plan card - a read-out, so it takes no dispatch */
function AccountPanel({ mo, accounts, members, currency, onClose }) {
  const {
    perPerson, shared, sharedAmt, byAccount,
    savingsAccount, savingsItems, savingsTotal, unassigned,
  } = walletPlan(mo, accounts, members);
  /* Which wallet is open on the right, held as an id rather than as the
     object: the plan is recomputed from the month on every edit behind this
     sheet, and an id survives that where a reference would not. Null means
     "none chosen yet", which resolves to the first wallet rather than to an
     empty panel. */
  const [openId, setOpenId] = useState(null);
  const selected = byAccount.find(t => t.account.id === openId) || byAccount[0] || null;

  return (
    <div className="fade-in">
      {/* per-person "who moves what" */}
      <div className="eyebrow wallet-eyebrow">Who moves what</div>
      <div className="wallet-movers">
        {perPerson.map(p => (
          <ObjectRow key={p.member.id} size="lg" className="wallet-mover"
            lead={<Avatar member={p.member} size={30} />}
            name={`${p.member.name} total`}
            sub={`into ${p.accts.map(t => t.account.name).join(" · ")}`}
            figure={fmt(currency, p.amount)} />
        ))}
        {shared.length > 0 && (
          <ObjectRow size="lg" className="wallet-mover"
            lead={<Tile size="sm" icon={Icons.user} tone="info" />}
            name="Shared total"
            sub={`into ${shared.map(t => t.account.name).join(" · ")}`}
            figure={fmt(currency, sharedAmt, { cents: false })} />
        )}
      </div>

      {/* every wallet, and whichever one is open */}
      <div className="eyebrow wallet-eyebrow">Wallets &amp; details</div>
      {byAccount.length === 0 ? (
        <EmptyState icon={Icons.coins} title="No wallets yet">
          Give an item a funding account on the budget and that account shows up here as a wallet.
        </EmptyState>
      ) : (
        <div className="wallet-split">
          <div className="wallet-grid">
            {byAccount.map(t => (
              <WalletCard key={t.account.id} t={t} currency={currency}
                selected={selected.account.id === t.account.id}
                onSelect={() => setOpenId(t.account.id)} />
            ))}
          </div>
          <WalletDetail t={selected} members={members} currency={currency} onClose={onClose} />
        </div>
      )}

      {/* savings wallets - breakdown of the savings group into the savings account's wallets */}
      {savingsItems.length > 0 && (
        <>
          <div className="eyebrow wallet-eyebrow wallet-savings-head">
            <span>{savingsAccount ? savingsAccount.name : "Savings"} wallets</span>
            <span className="num wallet-savings-total">{fmt(currency, savingsTotal)}</span>
          </div>
          <div className="panel is-clipped">
            {savingsItems.map((it, i) => (
              /* #96a1b4 is --muted resolved to a literal hex, because
                 hexToSoft cannot read a CSS var. It keeps the tint under the
                 icon in step with the icon's own colour above. Neutral, not
                 green: saving is not a success state to be congratulated. */
              <ObjectRow key={it.id} className={cx("wallet-savings-row", i && "is-divided")}
                lead={<Tile icon={Icons.plant} tint={savingsAccount ? savingsAccount.color : "#96a1b4"} />}
                name={it.name}
                meta={<>
                  <span className="wallet-meta-bar"><MiniBar actual={it.actual} allocated={it.allocated} /></span>
                  <span className="num wallet-fixed">{fmt(currency, it.actual, { cents: false })} moved</span>
                  {it.actual > it.allocated + 0.001 && <DiffPill diff={round2(it.allocated - it.actual)} currency={currency} />}
                </>}
                figure={fmt(currency, it.allocated)} />
            ))}
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

/* the Wallet sheet - the centred surface holding the panel.

   The veil stops the mouse reaching the budget behind it, so the keyboard must
   not be able to either: useFocusTrap gives this the same guarantee a modal
   has, which is the reason that behaviour is a hook and not something each
   overlay writes out. */
function WalletSheet({ mo, accounts, members, currency, month, onClose }) {
  const boxRef = useRef(null);
  useFocusTrap(boxRef, onClose);
  const { toFund } = walletSummary(mo, accounts);
  return (
    /* The sheet sits inside the veil so the veil can centre it; the target
       check is what keeps a click that lands on the sheet itself from
       reaching the veil's own handler and closing it. */
    <div className="sheet-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside ref={boxRef} className="sheet" role="dialog" aria-modal="true" aria-label="Wallet">
        <div className="sheet-head">
          <div className="wallet-head-id">
            <span className="wallet-head-mark"><Icons.wallet size={19} /></span>
            <div>
              <div className="wallet-head-title">Wallet</div>
              <div className="wallet-head-sub">Movements for {monthLabel(month).mo}</div>
            </div>
          </div>
          <Stat className="wallet-head-total" label="Total to move" figure={fmt(currency, toFund)} />
          <button className="icon-btn" onClick={onClose} aria-label="Close the Wallet" title="Close"><Icons.x size={18} /></button>
        </div>
        <div className="sheet-body">
          <AccountPanel mo={mo} accounts={accounts} members={members} currency={currency} onClose={onClose} />
        </div>
      </aside>
    </div>
  );
}

export { AccountSelect, AccountPanel, WalletSheet, AccountDot, ACCT_TYPE_LABEL, ACCT_ICON };
