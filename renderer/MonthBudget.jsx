/* ============================================================
   Month Budget screen - the main working screen
   ============================================================ */
import { Avatar, EmptyState, Icons, MoneyInput, Section, TextInline } from './ui/index.js';
import { fmt } from './lib/index.js';
import { useStore } from './store.jsx';

/* ---- income section ----------------------------------------------------- */
function IncomeSection({ mo, currency, members, dispatch, month }) {
  const { toast } = useStore();

  /* No confirm dialog here: a deleted income row is one member, one label and
     one number, and the toast can put all three back.

     Undoing takes two writes, because 'addIncome' only takes a member and the
     row it creates is blank. The store hands that row back, so the second
     write puts the source and the amount onto it. */
  const removeIncome = (inc, memberName) => {
    dispatch({ type: "removeIncome", month, id: inc.id });
    toast(`Removed ${inc.label ? `"${inc.label}"` : "income"} for ${memberName}.`, "success", {
      label: "Undo",
      onAct: async () => {
        const { ok, value } = await dispatch({ type: "addIncome", month, memberId: inc.memberId });
        if (!ok || !value) return;
        dispatch({ type: "updateIncome", month, id: value.id, patch: { label: inc.label || "", amount: inc.amount } });
      },
    });
  };
  return (
    <>
      <Section title="Income" />
      <div className="panel is-clipped">
        {mo.incomes.length === 0 && (
          <EmptyState icon={Icons.coins} inline panel={false}>No income entered yet for this month.</EmptyState>
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
