/* ============================================================
   Spending by group, for the Dashboard's pie.

   groupSpending(months, groups, pick, averageOver) splits spending across
   groups for one of `months` (`pick` is "YYYY-MM"), or for the average month
   of `averageOver` (`pick` null; it defaults to `months`, and the Dashboard
   passes only the finished ones).
   Savings groups are left out: money put aside is not spending.

   A group's colour slot follows the group, never its rank in the view on
   screen: slots are dealt out by each group's total over all of `months`,
   so switching between months reorders the slices but never repaints them.
   The palette has eight colours, so past eight groups the seven biggest keep
   a slot and the rest fold into one "Other" slice (slot 'other').
   ============================================================ */
const MAX_SLOTS = 8;

const spentOn = (m, id) => (m.byGroupId && m.byGroupId[id]) || 0;

export function groupSpending(months, groups, pick, averageOver = months) {
  const spend = [...groups.entries()].filter(([, g]) => g.kind !== "savings");

  // Slots, by each group's total over every month.
  const ranked = spend
    .map(([id, g]) => ({ id, name: g.name, total: months.reduce((a, m) => a + spentOn(m, id), 0) }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);
  const fold = ranked.length > MAX_SLOTS;
  const slotOf = new Map(ranked.map((g, i) => [g.id, fold && i >= MAX_SLOTS - 1 ? "other" : i]));

  // Values for the view: one month, or the average of all of them.
  const view = pick == null ? averageOver : months.filter((m) => m.month === pick);
  const per = (id) => (view.length ? view.reduce((a, m) => a + spentOn(m, id), 0) / view.length : 0);

  const own = [];
  let other = 0;
  for (const [id, g] of spend) {
    const value = per(id);
    if (!(value > 0)) continue;
    const slot = slotOf.has(id) ? slotOf.get(id) : "other";
    if (slot === "other") other += value;
    else own.push({ id, name: g.name, value, slot });
  }
  // Biggest first; a tie keeps the colour order, and Other always comes last.
  own.sort((a, b) => b.value - a.value || a.slot - b.slot);
  if (other > 0) own.push({ id: "other", name: "Other", value: other, slot: "other" });

  const total = own.reduce((a, s) => a + s.value, 0);
  return { slices: own.map((s) => ({ ...s, share: total ? s.value / total : 0 })), total };
}
