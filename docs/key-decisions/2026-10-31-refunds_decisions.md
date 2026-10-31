# 2026-10-31 key decisions: refunds and money back

**Related:** [upload transactions](../features/upload-transactions_feature.md) · builds on [#33 upload transactions](pr33-upload-transactions_decisions.md) and [#37 upload review](pr37-upload-review_decisions.md)

**Engineer** is the person who works on the app. The **Coding Agent** proposed the design and built it.

A household member orders far more online than they keep and returns most of it. Until now every credit on a statement was blocked as "Money in", so returns had to be worked out by hand. The Engineer had been doing it like this: ignore a purchase returned in full in the same month, reduce a purchase by a partial return, and count a purchase in full in its month with the refund as income in the next month if it hadn't arrived yet.

## 1. A refund counts in the month the money arrives

- **Context:** the Engineer's three rules needed one principle, and the third ("if it hasn't arrived before the next month's budget is done") depended on when the books were done.
- **Decision:** a refund counts in the month its date falls in. Against a purchase in that month it nets; against an earlier month's purchase it is money back in the refund's month. The earlier month is not changed and may stay overspent, with a note saying what came back later.
- **Alternatives:** net a refund back into its purchase's month whenever it arrives; keep the Engineer's "before the budget is done" rule.
- **Why:** a zero-based budget plans cash, and money that comes back in November is November's money to give a job. Going by date is deterministic and matches the statement; the "budget done" rule gave different budgets for the same transactions depending on when they were imported. The Engineer accepted the overspent month, as long as it shows what came back.
- **Decided by:** Engineer, on the Coding Agent's recommendation.

## 2. Keep the purchase; write the refund as its own negative entry

- **Context:** the Engineer had been editing the purchase amount down.
- **Decision:** the purchase entry keeps the bank's amount. The refund is a separate entry with `kind = 'refund'`, a negative amount, and a link to the purchase (`refund_of_entry_id`). Migration 12 rebuilds the entries table so the amount CHECK allows a negative amount only on a refund.
- **Alternatives:** edit the purchase amount (loses the record and breaks re-upload and duplicate matching); keep amounts positive with a refund flag (every SUM of entries in the months repository and the renderer's selectors would need a sign).
- **Why:** every total already sums entries, so netting works with no change to totals, charts or over-budget checks. The bank's amounts stay as they were, so re-uploads and duplicate checks keep working. A refund's amount can't be edited, since it is the bank's.
- **Decided by:** Coding Agent; Engineer approved.

## 3. Money back is a kind of income line

- **Context:** a refund of an earlier month's purchase, and money in with no purchase, have to land somewhere in this month.
- **Decision:** a `budget_incomes` row with `kind = 'money_back'`, linked to its bank row and its purchase if any. It goes to the card's owner, or the first member for a joint account. Starting a new month never copies it.
- **Alternatives:** a negative entry on the same category in the new month; a separate money-back table.
- **Why:** as income, the money shows as unallocated and asks for a job, which is the zero-based thing to do. As a credit to the category, the new month's line would look underspent though nothing about the spending changed, and with no carryover the money would disappear into that underspend. Its own kind keeps it apart from earnings for reports, and keeps "copy income" from repeating it every month.
- **Decided by:** Coding Agent; Engineer approved.

## 4. Same mechanism for all money in

- **Context:** cashback, a friend paying back for dinner, and salary also arrive as credits.
- **Decision:** every credit gets the same treatment. With a purchase it is a refund (or money back for an earlier month); without one it starts unticked as "Money in" and, if ticked, becomes money back. A refund of a purchase in the same upload that isn't being imported can't be ticked.
- **Alternatives:** keep non-refund credits blocked.
- **Why:** the Engineer asked for one mechanism. Unticked by default keeps salaries, which planned income already counts, from being counted twice.
- **Decided by:** Engineer.

## 5. How a refund finds its purchase

- **Context:** returns arrive as separate credits on the same card, often several per order, and descriptors differ slightly ("H&M", "H & M", a REFUND segment).
- **Decision:** candidates are spends on the same account, up to 90 days before the refund, whose merchant words overlap and with enough not yet refunded. They come from entries already in the budget and from debit rows of the same upload. Most alike name first, then most recent. Choices you made take their share of a purchase before suggestions do. The review shows the suggestion and offers up to five candidates plus "No purchase".
- **Alternatives:** match on amount too (returns are usually partial); suggest nothing and always ask.
- **Why:** partial returns rule out amount matching, and the same card plus the same shop within a season is nearly always right. Suggesting saves a click on most rows while staying visible and easy to change.
- **Decided by:** Coding Agent.
