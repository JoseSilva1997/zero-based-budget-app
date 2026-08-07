/* ============================================================
   Month Budget screen - the main working screen
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { Avatar, Icons, MoneyInput, TextInline } from './components.jsx';
import { fmt, monthActual, monthAllocated, monthIncome, monthSavings, monthUnallocated, overBudgetItems, round2 } from './lib/index.js';
import { focusAllocated } from './MonthGroups.jsx';
import { useStore } from './store.jsx';

/* overBudgetItems reports names; routing to the row that fixes one needs its
   id, so the reported rows are paired back to the tree by group and item name.
   Two items with the same name in one group route to the first of them, which
   is the right kind of wrong. */
function withRowIds(mo, over) {
  const byName = new Map();
  mo.groups.forEach((g) => g.items.forEach((it) => {
    const key = `${g.name}::${it.name}`;
    if (!byName.has(key)) byName.set(key, { id: it.id, groupId: g.id });
  }));
  return over.map((o) => ({ ...o, ...(byName.get(`${o.group}::${o.item}`) || {}) }));
}

function SummaryHero({ mo, currency }) {
  const income = monthIncome(mo), alloc = monthAllocated(mo), actual = monthActual(mo);
  const savings = monthSavings(mo), unalloc = monthUnallocated(mo);
  const over = withRowIds(mo, overBudgetItems(mo));
  const state = Math.abs(unalloc) < 0.005 ? "zero" : unalloc > 0 ? "left" : "over";
  const pctAlloc = income > 0 ? Math.min(alloc / income, 1) : 0;

  return (
    <div className="panel fade-in" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) 1.25fr" }}>
        {/* hero unallocated */}
        <div style={{ padding: "26px 28px", borderRight: "1px solid var(--rule)", display: "flex", flexDirection: "column", justifyContent: "space-between", background: state === "zero" ? "linear-gradient(160deg, var(--pos-soft), transparent)" : state === "over" ? "linear-gradient(160deg, var(--neg-soft), transparent)" : "transparent" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>
            {state === "zero" ? <Icons.check size={15} style={{ color: "var(--pos)" }} /> : <Icons.coins size={15} />}
            {state === "over" ? "Over-allocated" : "Left to allocate"}
          </div>
          <div>
            <div className="mono tnum" style={{ fontSize: 50, fontWeight: 500, lineHeight: 1, letterSpacing: "-0.03em", margin: "14px 0 8px", color: state === "zero" ? "var(--pos-ink)" : state === "over" ? "var(--neg-ink)" : "var(--ink)" }}>
              {fmt(currency, Math.abs(unalloc))}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.4 }}>
              {state === "zero" && <span style={{ color: "var(--pos-ink)", fontWeight: 500 }}>Every {currency} has a job, this month is fully allocated.</span>}
              {state === "left" && <>Assign this to a group or to savings to reach zero.</>}
              {state === "over" && <span style={{ color: "var(--neg-ink)", fontWeight: 500 }}>You've allocated more than you earn. Trim {fmt(currency, Math.abs(unalloc), { cents: false })}.</span>}
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
              <span>{fmt(currency, alloc, { cents: false })} allocated</span>
              <span>{Math.round(pctAlloc * 100)}% of income</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: "var(--well)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: "100%", transformOrigin: "left", transform: `scaleX(${pctAlloc})`, background: state === "over" ? "var(--neg)" : "var(--pos)", transition: "transform .35s ease" }} />
            </div>
          </div>
        </div>
        {/* stat tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
          <Stat label="Total income" value={fmt(currency, income)} tone="ink" />
          <Stat label="Total allocated" value={fmt(currency, alloc)} tone="ink" border />
          <Stat label="Total actual" value={fmt(currency, actual)} sub={`${income>0?Math.round(actual/income*100):0}% of income spent`} top />
          <Stat label="Savings allocated" value={fmt(currency, savings)} tone="pos" icon={<Icons.plant size={15} />} border top />
        </div>
      </div>
      {over.length > 0 && (
        /* The named items are links, not a read-out: being told which three
           items are over and then having to go hunting for them is what makes
           this the worst moment on the screen. Nothing here may push the total
           out of the card either, so the names are the only part that gives
           way. */
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 22px", borderTop: "1px solid var(--rule)", background: "var(--neg-soft)", color: "var(--neg-ink)", fontSize: 13 }}>
          <Icons.alert size={16} style={{ flex: "none" }} />
          <strong style={{ fontWeight: 600, flex: "none" }}>{over.length} item{over.length > 1 ? "s" : ""} over budget</strong>
          <span style={{ opacity: 0.9, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ·{" "}
            {over.slice(0, 3).map((o, i) => (
              <span key={`${o.id != null ? o.id : o.item}-${i}`}>
                {i > 0 ? ", " : ""}
                <button type="button" onClick={() => focusAllocated(o.id, o.groupId)}
                  title={`Go to ${o.item} in ${o.group}`}
                  aria-label={`Go to ${o.item} in ${o.group}, ${fmt(currency, o.over)} over`}
                  style={{ background: "transparent", border: 0, padding: 0, font: "inherit", color: "inherit", textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer" }}>
                  {o.item}
                </button>
              </span>
            ))}
            {over.length > 3 ? "…" : ""}
          </span>
          <span className="mono" style={{ marginLeft: "auto", fontWeight: 600, flex: "none" }}>{fmt(currency, sumOver(over))} over total</span>
        </div>
      )}
    </div>
  );
}
function sumOver(over) { return round2(over.reduce((a, o) => a + o.over, 0)); }

function Stat({ label, value, sub, tone, icon, border, top }) {
  return (
    <div style={{ padding: "18px 22px", borderLeft: border ? "1px solid var(--rule)" : "none", borderTop: top ? "1px solid var(--rule)" : "none", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", fontWeight: 500, marginBottom: 8 }}>{icon}{label}</div>
      <div className="mono" style={{ fontSize: 23, fontWeight: 500, letterSpacing: "-0.01em", color: tone === "pos" ? "var(--pos-ink)" : "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/* ---- income section ----------------------------------------------------- */
function IncomeSection({ mo, currency, members, dispatch, month }) {
  const { toast } = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const total = monthIncome(mo);
  const byMember = members.map(m => ({ m, total: round2(mo.incomes.filter(i => i.memberId === m.id).reduce((a, i) => a + i.amount, 0)) }));

  /* Undoing a removed income row takes two writes: 'addIncome' only takes a
     member, and dispatch cannot hand back the id it created. So the second
     write waits for the row to appear - the one carrying that member that was
     not there a moment ago - and then puts the source and the amount back. */
  const incomesRef = useRef(mo.incomes);
  const restoreRef = useRef(null);
  useEffect(() => {
    incomesRef.current = mo.incomes;
    const pending = restoreRef.current;
    if (!pending) return;
    const fresh = mo.incomes.find(i => !pending.known.has(i.id) && String(i.memberId) === String(pending.memberId));
    if (!fresh) return;
    restoreRef.current = null;
    dispatch({ type: "updateIncome", month, id: fresh.id, patch: { label: pending.label, amount: pending.amount } });
  }, [mo.incomes, dispatch, month]);

  /* No confirm dialog here: a deleted income row is one member, one label and
     one number, and the toast can put all three back. */
  const removeIncome = (inc, memberName) => {
    restoreRef.current = null;
    dispatch({ type: "removeIncome", month, id: inc.id });
    toast(`Removed ${inc.label ? `"${inc.label}"` : "income"} for ${memberName}.`, "success", {
      label: "Undo",
      onAct: () => {
        restoreRef.current = {
          memberId: inc.memberId,
          label: inc.label || "",
          amount: inc.amount,
          known: new Set(incomesRef.current.map(i => i.id)),
        };
        dispatch({ type: "addIncome", month, memberId: inc.memberId });
      },
    });
  };
  return (
    <>
      <div className="section-head">
        <h2>Income</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Combined</span>
          <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{fmt(currency, total)}</span>
        </div>
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {mo.incomes.length === 0 && (
          <div className="empty" style={{ padding: "30px" }}>
            <div className="empty-icon"><Icons.coins size={20} /></div>
            <div style={{ fontSize: 14 }}>No income entered yet for this month.</div>
          </div>
        )}
        {mo.incomes.map((inc, idx) => {
          const m = members.find(x => x.id === inc.memberId) || members[0];
          return (
            <div className="income-row" key={inc.id} style={{ display: "grid", gridTemplateColumns: "1fr 200px 150px 40px", alignItems: "center", gap: 10, padding: "9px 16px", borderTop: idx ? "1px solid var(--rule-faint)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar member={m} />
                <select value={inc.memberId} aria-label="Who this income belongs to" onChange={(e) => dispatch({ type: "updateIncome", month, id: inc.id, patch: { memberId: e.target.value } })}
                  style={{ border: "1px solid transparent", background: "transparent", fontFamily: "inherit", fontSize: 13.5, fontWeight: 500, color: "var(--ink)", borderRadius: 6, padding: "3px 4px", cursor: "pointer" }}>
                  {members.map(mm => <option key={mm.id} value={mm.id}>{mm.name}</option>)}
                </select>
              </div>
              <TextInline value={inc.label} col="incomeLabel" label="Income source" onCommit={(v) => dispatch({ type: "updateIncome", month, id: inc.id, patch: { label: v } })} placeholder="Source" style={{ fontWeight: 400, color: "var(--ink-2)", fontSize: 13 }} />
              <MoneyInput value={inc.amount} currency={currency} col="income" label="Income amount"
                onCommit={(v) => dispatch({ type: "updateIncome", month, id: inc.id, patch: { amount: v } })} />
              <div className="row-actions">
                <button className="icon-btn" title="Remove" onClick={() => removeIncome(inc, m ? m.name : "this household")}
                  aria-label={`Remove ${inc.label ? `"${inc.label}"` : "unnamed"} income of ${fmt(currency, inc.amount)} for ${m ? m.name : "this household"}`}><Icons.trash size={15} /></button>
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 6, padding: "10px 16px", borderTop: "1px solid var(--rule-strong)", background: "var(--board)" }}>
          {members.map(m => (
            <button key={m.id} className="btn btn-sm btn-ghost" onClick={() => dispatch({ type: "addIncome", month, memberId: m.id })}>
              <Icons.plus size={14} /> Income for {m.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export { SummaryHero, IncomeSection };
