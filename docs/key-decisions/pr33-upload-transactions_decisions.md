# PR 33 key decisions: upload transactions from bank statements

**Related:** feature [upload transactions](../features/upload-transactions_feature.md) · builds on [#32 categories](pr32-categories_decisions.md) · [overview](../pr-overview/pr33-upload-transactions_overview.md) · [spec](../specs/pr33-upload-transactions_spec.md)

**Engineer** is the person who worked on the feature. Agents are named by role: the **Planner Agent** ran the build and made the calls the Engineer delegated; **Coding Agents** built each part; **Reviewer Agents** reviewed the finished branch.

## 1. CSV, not PDF

- **Context:** the first design read PDF statements.
- **Decision:** accept CSV only, behind an adapter layer so other formats can be added later.
- **Alternatives:** local PDF text extraction with a parser per bank; an LLM reading the PDF.
- **Why:** every bank the Engineer uses exports CSV, which is far more reliable to parse than PDF. That also made local parsing enough.
- **Decided by:** Engineer.

## 2. Local parsing and a local classifier, no LLM

- **Context:** an LLM could parse and categorise any statement, but bank data would leave the machine, and it would need an API key and internet.
- **Decision:** everything runs locally. Rows are parsed by built-in presets, and a small TF-IDF + kNN classifier written in TypeScript (no native or Python dependency) suggests the category.
- **Alternatives:** an LLM (opt-in, with the user's own key); naive Bayes.
- **Why:** this is private household data; CSV removed the need for an LLM's robustness; and the classifier is retrained in milliseconds.
- **Decided by:** Engineer (local first, and a trained model rather than hand-written rules); Planner Agent (kNN and its thresholds).

## 3. Built-in bank presets, not a configurable column mapping

- **Context:** the four banks' exports had quirks a generic mapping can't express:
  - Revolut's fee and state columns
  - Monzo's pot transfers and separate Name column
  - NatWest's card date inside the description, and its comma-separated merchant text
- **Decision:** one small adapter per bank in code, behind a shared interface, detected from the header. A `banks` table holds the user's name for the bank and its preset key.
- **Alternatives:** a user-configured mapping per bank (column names, date format, sign rules), which would have grown into a rules engine.
- **Why:** four known banks, each a well-tested adapter of about 50–90 lines. A fifth bank gets a fifth preset.
- **Decided by:** Planner Agent (proposal), agreed by Engineer.

## 4. Debits only, and credits blocked

- **Context:** entries are stored as non-negative spend; income has its own table.
- **Decision:** only debits can become entries. Credits are shown as "Money in" and can't be ticked. Refunds are parked.
- **Alternatives:** refunds that reduce a category; offering credits as income.
- **Why:** this needs no schema change, and showing the skipped rows keeps every upload auditable.
- **Decided by:** Engineer.

## 5. The target month is the month on screen; rows outside it are flagged

- **Context:** statement periods don't match calendar months, and card payments post days late.
- **Decision:**
  - An upload always goes into the month you're on.
  - Rows dated outside it get `out_of_month` and start unticked; ticking one imports it with its real date.
  - `spent_on` is the transaction date where the bank gives one, not the posting date.
- **Alternatives:** route each row to its own month; clamp out-of-month dates to the month.
- **Why:** it matches how the Engineer works ("doing October's actuals"), and the label catches a statement uploaded into the wrong month.
- **Decided by:** Engineer.

## 6. Review everything, confirm once

- **Context:** the Engineer wants to approve every row before it reaches the budget.
- **Decision:** one review list with sensible defaults (clean rows pre-ticked, warnings unticked, blocked rows locked), then one **Confirm** for the whole upload.
- **Alternatives:** tick every row by hand.
- **Why:** ticking 60 boxes trains you to click without reading. Defaults plus labels focus attention on the rows that need it.
- **Decided by:** Engineer.

## 7. Labels are computed, never stored

- **Context:** whether a row is a duplicate, already imported or outside the plan depends on the database at the moment you look, and an upload can stay pending for days.
- **Decision:**
  - Store only the user's decisions (category, name, kind, ticked, matched entry).
  - Recompute predictions and labels on every read.
  - `kind` and `included` are nullable, so "not decided yet" differs from "decided".
- **Alternatives:** store labels when the file is parsed.
- **Why:** stored labels go stale silently; recomputing costs about 300 ms for 1,000+ rows.
- **Decided by:** Planner Agent.

## 8. One fingerprint rule for every bank

- **Context:** the same transaction can appear in several exports. Monzo provides a transaction ID; the others don't.
- **Decision:** fingerprint = hash of (account, spent date, amount, direction, raw descriptor, occurrence number among identical rows in the file), for every bank.
- **Alternatives:** use Monzo's ID where available.
- **Why:** one rule is simpler to reason about. The occurrence number keeps two identical purchases on one day apart.
- **Decided by:** Engineer.

## 9. Bootstrap the classifier through the normal upload ("Same as existing")

- **Context:** months of hand-typed entries are labelled data, but in the wrong vocabulary: "Weekly shop" is not "CARD PAYMENT TO …".
- **Decision:**
  - Upload old statements into months you already entered by hand.
  - Most rows come up as possible duplicates, and **Same as existing** links each to its typed entry. That creates no new entry and gives one training example.
  - There is no separate training tool.
- **Alternatives:** train on typed entry names; a one-off training screen.
- **Why:** this pairs real bank descriptors with real categories, and exercises the whole pipeline on months whose answers are already known.
- **Decided by:** Planner Agent (proposal), agreed by Engineer.

## 10. One pending upload per month, saved, with Undo

- **Context:** a review can take a while, and parsing and review work shouldn't be lost.
- **Decision:**
  - Uploads are saved (`import_batches`), with at most one pending per month.
  - Reopening resumes it.
  - Discard deletes it.
  - After confirming, **Undo** deletes exactly the entries that upload created and returns it to pending.
- **Alternatives:** keep the review in memory only; no undo.
- **Why:** you can leave and come back, and a bad import is reversible without touching hand-typed entries.
- **Decided by:** Engineer (saved batch, undo); Planner Agent (discard deletes rather than archives).

## 11. A large overlay (sheet), not a separate screen

- **Context:** reviewing 50–100 rows needs room.
- **Decision:** the existing **sheet** overlay (the Wallet's), larger than a dialog, over Month Budget. It became a shared `Sheet` component.
- **Alternatives:** a full screen like History.
- **Why:** uploading is an action inside Month Budget, not a place of its own.
- **Decided by:** Engineer.

## 12. Label chips are colour-coded, as a named design exception

- **Context:** DESIGN.md's One Failure Rule gives a colour only to failure.
- **Decision:** the review's label chips are coloured by severity: Ember for block, a new **Lantern Amber** for warn, neutral for info. This is recorded in DESIGN.md as "The Label Chip Exception".
- **Alternatives:** neutral chips, with severity shown only by position and state.
- **Why:** colour makes a long list scannable.
- **Decided by:** Engineer.

## 13. "No category" is amber, not red

- **Context:** on a first real import, almost every row is uncategorised (79 of 87 in one test), so red chips made the list a wall of failure.
- **Decision:** `uncategorised` is warn severity (amber). The rule that it can't be ticked without a category is kept separately, and the row stays live.
- **Why:** it's a normal starting state, not a failure.
- **Decided by:** Planner Agent.

## 14. Fixtures are invented, and real statements are never committed

- **Context:** the repository is public, and the first fixtures were real statement rows with only names and account numbers swapped. Their merchants, towns, card digits and references still identified the Engineer.
- **Decision:** every fixture value is invented, and the branch history was rewritten before pushing so no real value was ever published. Real exports stay in a gitignored `bank_statements/` and are only used locally, reporting aggregate counts.
- **Why:** privacy. Swapping names alone isn't enough to anonymise a statement.
- **Decided by:** Reviewer Agent (caught it), Planner Agent (rewrote the history), Engineer (the general rule, now in `docs/README.md`).
