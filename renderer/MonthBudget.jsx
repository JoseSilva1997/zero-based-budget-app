/* ============================================================
   Month Budget screen - the main working screen
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { Avatar, Icons, MoneyInput, TextInline } from './ui/index.js';
import { fmt, monthIncome, round2 } from './lib/index.js';
import { useStore } from './store.jsx';

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
      </div>
      <div className="panel is-clipped">
        {mo.incomes.length === 0 && (
          <div className="empty income-empty">
            <div className="empty-icon"><Icons.coins size={20} /></div>
            <div className="income-empty-text">No income entered yet for this month.</div>
          </div>
        )}
        {mo.incomes.map((inc) => {
          const m = members.find(x => x.id === inc.memberId) || members[0];
          return (
            /* Two classes, and the geometry is on the second one. .income-row is
               shared with QuickEntry's "Just logged" rows and exists only to
               reveal .row-actions on hover; .income-grid is this table's own
               tracks. */
            <div className="income-row income-grid" key={inc.id}>
              <div className="income-who">
                <Avatar member={m} />
                <select value={inc.memberId} aria-label="Who this income belongs to" onChange={(e) => dispatch({ type: "updateIncome", month, id: inc.id, patch: { memberId: e.target.value } })}
                  className="sel income-member">
                  {members.map(mm => <option key={mm.id} value={mm.id}>{mm.name}</option>)}
                </select>
              </div>
              <TextInline value={inc.label} className="income-label" col="incomeLabel" label="Income source" onCommit={(v) => dispatch({ type: "updateIncome", month, id: inc.id, patch: { label: v } })} placeholder="Source" />
              <MoneyInput value={inc.amount} currency={currency} col="income" label="Income amount"
                onCommit={(v) => dispatch({ type: "updateIncome", month, id: inc.id, patch: { amount: v } })} />
              <div className="row-actions">
                <button className="icon-btn" title="Remove" onClick={() => removeIncome(inc, m ? m.name : "this household")}
                  aria-label={`Remove ${inc.label ? `"${inc.label}"` : "unnamed"} income of ${fmt(currency, inc.amount)} for ${m ? m.name : "this household"}`}><Icons.trash size={15} /></button>
              </div>
            </div>
          );
        })}
        <div className="income-add">
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

export { IncomeSection };
