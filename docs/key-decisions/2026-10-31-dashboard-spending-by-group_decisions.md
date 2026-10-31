# 2026-10-31 key decisions: dashboard spending by group

**Related:** [dashboard](../features/dashboard_feature.md) · builds on [dashboard cards](2026-10-31-dashboard-cards_decisions.md)

**Engineer** is the person who works on the app. The **Coding Agent** built it.

The Engineer asked for a pie chart of spending by group next to "Saved each month", with a choice of one month or the average of all of them (the default), and a toggle between totals and percentages.

## 1. The average is of the finished months

- **Context:** the charts show the last 12 months including the one in progress, which is only partly spent.
- **Decision:** "All months (average)" averages the finished months of the window that had spending. The month in progress can still be picked on its own.
- **Alternatives:** average every month on the chart, the current one included.
- **Why:** half a month would pull every group's average down. This matches the cards, which also leave the month in progress out.
- **Decided by:** Engineer (average by default); Coding Agent (finished months only).

## 2. Savings are left out

- **Context:** savings groups are entered like spending.
- **Decision:** only spend and debt groups are slices, and the card's subtitle says savings are not counted.
- **Alternatives:** include savings groups as slices.
- **Why:** the same rule as the cards: money put aside is not spent, and "Saved each month" beside it already shows the savings.
- **Decided by:** Coding Agent.

## 3. Colour follows the group, and more than eight fold into Other

- **Context:** the app's group palette has eight colours, and the order of slices changes from month to month.
- **Decision:** each group's colour is fixed by its total over the whole window, so switching months reorders the slices without repainting them. With more than eight groups, the seven biggest keep a colour and the rest share one grey "Other" slice. The legend beside the pie names every slice with its figure.
- **Alternatives:** colour by rank in the month shown; generate more colours.
- **Why:** a colour that moves to another group when the month changes reads as a different group. Generated colours past eight can't be told apart. Names in the legend mean no slice is known by colour alone.
- **Decided by:** Coding Agent.

## 4. Laid out 3:2 beside "Saved each month"

- **Context:** "Saved each month" was full width.
- **Decision:** the two charts share a row, the bars taking three fifths. Below a 1200px window the pie's legend moves under the pie.
- **Alternatives:** half and half.
- **Why:** twelve bars with their labels need the width more than a pie does. At the narrowest window the legend beside the pie cut off group names.
- **Decided by:** Engineer (next to Saved each month); Coding Agent (the split, the narrow layout).
