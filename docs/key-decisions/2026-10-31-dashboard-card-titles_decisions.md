# 2026-10-31 key decisions: dashboard card titles

**Related:** [dashboard](../features/dashboard_feature.md) · builds on [dashboard cards](2026-10-31-dashboard-cards_decisions.md)

**Engineer** is the person who works on the app. The **Coding Agent** built it.

Each card showed its figure with a sentence under it written for that stat ("spent a month on average, savings included"). The Engineer asked for every card to be the stat's title at the top and the figure in the card, instead.

## 1. The title is the stat's name, with the card's choice in it

- **Context:** with the sentence gone, a card such as "Average monthly spend on…" would no longer say which group or category it shows.
- **Decision:** the title writes the choice in: "Average monthly spend on Food", "Saved toward Holiday", "Longest run saving 15% of income or more". The 12-month total says how many months it covers when there are fewer ("Total spent in the last 4 months on Food"). A choice not made yet, or one that no longer exists, keeps the open name.
- **Alternatives:** the plain stat name, with the choice nowhere on the card.
- **Why:** two cards of the same stat on different groups would otherwise look identical.
- **Decided by:** Engineer (title and figure only); Coding Agent (the choice in the title).

## 2. The explaining sentence becomes the tooltip

- **Context:** for some stats the sentence carried something the figure cannot: which month was the best, "up from 12%", the top group's share, how many months went over, and what a dash is waiting for.
- **Decision:** the sentence is kept as the card's tooltip and is read after the figure by a screen reader. It is not printed.
- **Alternatives:** drop it; print it only for the stats that need it.
- **Why:** the card stays as plain as the Engineer asked, and nothing is lost for someone who wants to know more.
- **Decided by:** Coding Agent.
