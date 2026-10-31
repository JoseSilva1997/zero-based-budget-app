# 2026-10-31 key decisions: savings groups on the spend cards

**Related:** [dashboard](../features/dashboard_feature.md) · revisits decision 5 of [dashboard cards](2026-10-31-dashboard-cards_decisions.md)

**Engineer** is the person who works on the app. The **Coding Agent** built it.

The cards first offered only spend groups and their categories for "on…" stats, because savings are not spending. The Engineer asked for savings groups to be offered on "Average monthly spend on…", "Median monthly spend on…" and "Total spent in the last 12 months on…".

## 1. Three stats offer savings groups; the share of spending does not

- **Context:** four stats ask for a group or category. Three give an amount; "Share of spending on…" gives a part of all spending.
- **Decision:** the average, median and total list savings groups and their categories with the others, and show what was entered against them. "Share of spending on…" still lists spend groups only. Each stat says which it does (`savings: true` in `renderer/lib/dashboardStats.js`).
- **Alternatives:** offer savings groups on all four.
- **Why:** the Engineer named the three. For the share, savings are not part of the spending it divides by, so a savings group's share would be a figure over a total it is not in.
- **Decided by:** Engineer (the three stats); Coding Agent (leaving the share out).
