# PR 37 key decisions: upload review improvements

**Related:** feature [upload transactions](../features/upload-transactions_feature.md) · builds on [#33 upload transactions](pr33-upload-transactions_decisions.md) · [overview](../pr-overview/pr37-upload-review_overview.md)

**Engineer** is the person who worked on the feature. The **Coding Agent** questioned the Engineer on each change, recommended answers, and built and tested what was agreed.

## 1. Only a category you picked teaches

- **Context:** an unticked row can carry a category from the Engineer or from the classifier's own guess.
- **Decision:** a row teaches when you set its category, whatever it started as, including a corrected guess.
- **Alternatives:** only rows that started as "No category"; any unticked row with a category, guessed or not.
- **Why:** your pick is the signal. Learning from unchecked guesses would let the classifier reinforce its own mistakes.
- **Decided by:** Engineer.

## 2. Possible duplicates and rows outside the month teach too

- **Context:** the first idea excluded possible duplicates.
- **Decision:** they teach when left unticked with a category you picked, as do rows outside the month.
- **Alternatives:** exclude possible duplicates, so that matching them is the only way they teach.
- **Why:** the category is true whether or not the spend was typed in already, and it is one less rule.
- **Decided by:** Engineer.

## 3. Blocked rows, transfers and archived categories don't teach

- **Context:** money in, already-imported, unreadable and not-completed rows can't be ticked; a row can carry a category and be a transfer; a category can be archived after it was picked.
- **Decision:** none of these teach a category. A transfer teaches "transfer" the way it already did. Archived categories are filtered at training time, as entries' are.
- **Alternatives:** let blocked rows take a category for teaching (refunds, for example).
- **Why:** money in isn't spending, an already-imported row has taught already, and the picker never offers an archived category.
- **Decided by:** Engineer (blocked rows); Engineer, on the Coding Agent's recommendation (transfers, archived).

## 4. Confirm goes through when lessons are all there is

- **Context:** Confirm was refused with nothing ticked or matched.
- **Decision:** rows that teach count as something to confirm. The import is listed in history as "0 entries", and Undo takes its lessons back.
- **Alternatives:** keep the refusal, so the Engineer would import a row they didn't want just to save the lessons.
- **Why:** classifying without importing is the point of the change.
- **Decided by:** Engineer.

## 5. A re-upload may tick a taught row again

- **Context:** a taught row isn't an entry, so it isn't "already imported"; once learnt, its category may be predicted confidently on a re-upload of the same statement.
- **Decision:** accept it.
- **Alternatives:** treat taught rows as already imported, or start them unticked with a "Skipped before" label.
- **Why:** re-uploading a statement is rare, and unticking again is cheap.
- **Decided by:** Engineer, against the Coding Agent's recommendation of a "Skipped before" label.

## 6. Said in the footer only

- **Context:** the review needs to say that an unticked, categorised row will teach.
- **Decision:** the footer adds "· N to learn from"; the toast adds "N learnt", or only "Learnt N categories." when nothing was imported.
- **Alternatives:** a hint on each row.
- **Why:** quiet, and it explains why Confirm is enabled with nothing ticked.
- **Decided by:** Engineer.

## 7. Teaching is recorded at Confirm, and decided by the server

- **Context:** whether a row taught depends on things computed against the database at that moment: its blocks, and a kind that may come from the classifier's prediction. SQL over the stored decisions afterwards can't tell.
- **Decision:** `assessRow` computes `teaches`; Confirm saves it as `import_rows.teaches`, which training reads and Undo clears. The review sends the flag, and the renderer only counts it.
- **Alternatives:** derive teaching rows in SQL at training time; repeat the rule in the renderer.
- **Why:** one rule in one place, and what was taught stays what it was when you confirmed.
- **Decided by:** Coding Agent.

## 8. A note sits on a line under its row

- **Context:** the review row's grid is full.
- **Decision:** a pencil in the row's actions opens a note line under the row, aligned with the name; a written note stays on show. Matched rows, transfers and blocked rows take none.
- **Alternatives:** a note column on every row; for matched rows, filling the existing entry's empty note.
- **Why:** the grid keeps its columns, and only rows that write an entry have somewhere for the note to go.
- **Decided by:** Engineer (line under the row, none on matched rows); Coding Agent (a pencil instead of a word button, none on transfers and blocked rows).

## 9. The note gets its own migration, 11

- **Context:** a development build of this branch, launched to try it, ran migration 10 on the Engineer's real database when 10 added only `teaches`. Folding `note` into 10 afterwards meant that database would never get it, and its first Confirm would fail.
- **Decision:** `note` is added by migration 11, and a test migrates a version-10 database that lacks it.
- **Alternatives:** keep it in 10 and repair that one database by hand.
- **Why:** a shipped or run migration never changes; the next one does the work. Dev launches no longer open real data since [#43](../pr-overview/pr43-dev-data-folder_overview.md).
- **Decided by:** Coding Agent.

## 10. Empty trailing header names are not columns, for every bank

- **Context:** one Lloyds export ended its header line with a comma, which read as an empty ninth column, and preset detection needs the exact set of names.
- **Decision:** the CSV reader drops empty names at the end of the header.
- **Alternatives:** relax only the Lloyds preset; ignore all empty names anywhere.
- **Why:** an empty trailing name means nothing for any bank, and detection stays exact for every real column.
- **Decided by:** Coding Agent.

## 11. Shared-account purchases need a category, not code

- **Context:** on a joint account, the same payee (a train ticket) can be either person's, but the money is still transport.
- **Decision:** no change; the Engineer uses a joint-only category such as "Joint transport".
- **Alternatives:** a per-person split, or a "who paid" field.
- **Why:** who made the purchase doesn't matter to the budget, and the classifier already tells accounts apart (its tokens include the account), which a quick simulation confirmed.
- **Decided by:** Engineer (the joint category); Coding Agent (checking the classifier handles it).
