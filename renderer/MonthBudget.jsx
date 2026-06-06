/* ============================================================
   Month Budget screen - the main working screen
   ============================================================ */
import { useState } from 'react';
import { Avatar, Icons, MoneyInput, TextInline } from './components.jsx';
import { fmt, monthActual, monthAllocated, monthIncome, monthSavings, monthUnallocated, overBudgetItems, round2 } from './lib/index.js';

function SummaryHero({ mo, currency }) {
  const income = monthIncome(mo), alloc = monthAllocated(mo), actual = monthActual(mo);
  const savings = monthSavings(mo), unalloc = monthUnallocated(mo);
  const over = overBudgetItems(mo);
  const state = Math.abs(unalloc) < 0.005 ? "zero" : unalloc > 0 ? "left" : "over";
  const pctAlloc = income > 0 ? Math.min(alloc / income, 1) : 0;

  return (
    <div className="card fade-in" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) 1.25fr" }}>
        {/* hero unallocated */}
        <div style={{ padding: "26px 28px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "space-between", background: state === "zero" ? "linear-gradient(160deg, var(--pos-soft), transparent)" : state === "over" ? "linear-gradient(160deg, var(--neg-soft), transparent)" : "transparent" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>
            {state === "zero" ? <Icons.check size={15} style={{ color: "var(--accent)" }} /> : <Icons.coins size={15} />}
            {state === "over" ? "Over-allocated" : "Left to allocate"}
          </div>
          <div>
            <div className="mono tnum" style={{ fontSize: 50, fontWeight: 500, lineHeight: 1, letterSpacing: "-0.03em", margin: "14px 0 8px", color: state === "zero" ? "var(--accent-ink)" : state === "over" ? "var(--neg-ink)" : "var(--ink)" }}>
              {fmt(currency, Math.abs(unalloc))}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.4 }}>
              {state === "zero" && <span style={{ color: "var(--accent-ink)", fontWeight: 500 }}>Every {currency} has a job, this month is fully allocated.</span>}
              {state === "left" && <>Assign this to a group or to savings to reach zero.</>}
              {state === "over" && <span style={{ color: "var(--neg-ink)", fontWeight: 500 }}>You've allocated more than you earn. Trim {fmt(currency, Math.abs(unalloc), { cents: false })}.</span>}
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
              <span>{fmt(currency, alloc, { cents: false })} allocated</span>
              <span>{Math.round(pctAlloc * 100)}% of income</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: "var(--surface-sunken)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pctAlloc * 100}%`, borderRadius: 99, background: state === "over" ? "var(--neg)" : "linear-gradient(90deg, var(--accent), var(--accent-strong))", transition: "width .35s ease" }} />
            </div>
          </div>
        </div>
        {/* stat tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
          <Stat label="Total income" value={fmt(currency, income)} tone="ink" />
          <Stat label="Total allocated" value={fmt(currency, alloc)} tone="ink" border />
          <Stat label="Total actual" value={fmt(currency, actual)} sub={`${income>0?Math.round(actual/income*100):0}% of income spent`} top />
          <Stat label="Savings allocated" value={fmt(currency, savings)} tone="accent" icon={<Icons.plant size={15} />} border top />
        </div>
      </div>
      {over.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 22px", borderTop: "1px solid var(--border)", background: "var(--neg-soft)", color: "var(--neg-ink)", fontSize: 13 }}>
          <Icons.alert size={16} />
          <strong style={{ fontWeight: 600 }}>{over.length} item{over.length > 1 ? "s" : ""} over budget</strong>
          <span style={{ opacity: 0.8 }}>· {over.slice(0, 3).map(o => o.item).join(", ")}{over.length > 3 ? "…" : ""}</span>
          <span className="mono" style={{ marginLeft: "auto", fontWeight: 600 }}>{fmt(currency, sumOver(over))} over total</span>
        </div>
      )}
    </div>
  );
}
function sumOver(over) { return round2(over.reduce((a, o) => a + o.over, 0)); }

function Stat({ label, value, sub, tone, icon, border, top }) {
  return (
    <div style={{ padding: "18px 22px", borderLeft: border ? "1px solid var(--border)" : "none", borderTop: top ? "1px solid var(--border)" : "none", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", fontWeight: 500, marginBottom: 8 }}>{icon}{label}</div>
      <div className="mono" style={{ fontSize: 23, fontWeight: 500, letterSpacing: "-0.01em", color: tone === "accent" ? "var(--accent-ink)" : "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/* ---- income section ----------------------------------------------------- */
function IncomeSection({ mo, currency, members, dispatch, month }) {
  const [addOpen, setAddOpen] = useState(false);
  const total = monthIncome(mo);
  const byMember = members.map(m => ({ m, total: round2(mo.incomes.filter(i => i.memberId === m.id).reduce((a, i) => a + i.amount, 0)) }));
  return (
    <>
      <div className="section-head">
        <h2>Income</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Combined</span>
          <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{fmt(currency, total)}</span>
        </div>
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        {mo.incomes.length === 0 && (
          <div className="empty" style={{ padding: "30px" }}>
            <div className="empty-icon"><Icons.coins size={20} /></div>
            <div style={{ fontSize: 14 }}>No income entered yet for this month.</div>
          </div>
        )}
        {mo.incomes.map((inc, idx) => {
          const m = members.find(x => x.id === inc.memberId) || members[0];
          return (
            <div className="income-row" key={inc.id} style={{ display: "grid", gridTemplateColumns: "1fr 200px 150px 40px", alignItems: "center", gap: 10, padding: "9px 16px", borderTop: idx ? "1px solid var(--hairline)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar member={m} />
                <select value={inc.memberId} onChange={(e) => dispatch({ type: "updateIncome", month, id: inc.id, patch: { memberId: e.target.value } })}
                  style={{ border: "1px solid transparent", background: "transparent", fontFamily: "inherit", fontSize: 13.5, fontWeight: 500, color: "var(--ink)", borderRadius: 6, padding: "3px 4px", cursor: "pointer" }}>
                  {members.map(mm => <option key={mm.id} value={mm.id}>{mm.name}</option>)}
                </select>
              </div>
              <TextInline value={inc.label} onCommit={(v) => dispatch({ type: "updateIncome", month, id: inc.id, patch: { label: v } })} placeholder="Source" style={{ fontWeight: 400, color: "var(--ink-2)", fontSize: 13 }} />
              <MoneyInput value={inc.amount} currency={currency} onCommit={(v) => dispatch({ type: "updateIncome", month, id: inc.id, patch: { amount: v } })} />
              <div className="row-actions"><button className="icon-btn" title="Remove" onClick={() => dispatch({ type: "removeIncome", month, id: inc.id })}><Icons.trash size={15} /></button></div>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 6, padding: "10px 16px", borderTop: "1px solid var(--border-strong)", background: "var(--surface-2)" }}>
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
