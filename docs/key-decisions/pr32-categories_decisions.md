# PR 32 key decisions: month-independent categories

**Related:** needed by [#33 upload transactions](pr33-upload-transactions_decisions.md) · [overview](../pr-overview/pr32-categories_overview.md) · [spec](../specs/pr32-categories_spec.md)

"Owner" is the project owner. "Planner" is the agent that ran the build and made calls the owner delegated.

## 1. Refactor the schema instead of adding a `lineage_id`

- **Context:** the upload classifier (#33) needs a class that means the same thing in every month, but items were re-cloned monthly with new IDs.
- **Decision:** introduce a real month-independent `categories` table and make `budget_items` per-month plan lines that point at it.
- **Alternatives:**
  - A `lineage_id` on `budget_items`, carried forward by `copyMonth`.
  - Matching on (group name, item name).
- **Why:** "Groceries in October is technically different from Groceries in September, but they're the same category." The owner chose to model that properly over patching it with a link column. Name matching breaks on the first rename.
- **Decided by:** owner.

## 2. Groups are global

- **Context:** groups were per month, but in practice the same groups recur every month.
- **Decision:** `budget_groups` loses `budget_month_id` and is shared by all months.
- **Alternatives:** keep groups per month, with only categories global.
- **Why:** a group's name and kind then mean the same thing everywhere, so History and charts can aggregate by group without matching names.
- **Decided by:** owner.

## 3. Account lives on the plan line, with a default on the category

- **Context:** transfer planning (the Wallet) works per month, per account.
- **Decision:** `budget_items.bank_account_id` stays per month. `categories.bank_account_id` is only the default for new lines, and it's updated whenever a line's account changes.
- **Alternatives:** the account only on the category, which would rewrite past months' Wallet views whenever it changed.
- **Why:** keeps history stable while still remembering the latest choice.
- **Decided by:** planner.

## 4. Renames and moves apply to every month

- **Context:** with one category shared by all months, a rename has to mean something.
- **Decision:** renaming or moving changes the category in all months, past ones included. If it's really a different thing, create a new category and archive the old one.
- **Alternatives:** per-month name overrides.
- **Why:** that's what "the same category" means. Overrides would bring back the ambiguity the refactor removes.
- **Decided by:** owner.

## 5. Archive, don't delete, anything still referenced

- **Context:** deleting a category with history would orphan entries and plan lines.
- **Decision:**
  - A category with any line or entry can only be archived: hidden from pickers and new months, kept in history.
  - Deleting a line from a month deletes only that line; the category is then pruned automatically if nothing references it.
- **Alternatives:** always archive (never auto-delete); allow hard deletes with cascades.
- **Why:** nothing with history is ever lost. An unreferenced category carries no information, so pruning it keeps lists clean.
- **Decided by:** owner (archive); planner (auto-pruning).

## 6. Migration merges on normalised names, after a backup

- **Context:** existing databases had one copy of each group and item per month.
- **Decision:**
  - Merge groups on normalised name, and items on normalised (group, item).
  - Run it as one transaction with a foreign-key check.
  - Take an automatic backup before any pending migration; refuse to start if the backup fails.
- **Alternatives:** an interactive mapping step at upgrade time.
- **Why:** exact merging is safe and automatic. Names that only look different ("Food" vs "Groceries") stay separate, and the merge action fixes them by hand.
- **Decided by:** owner (approach); planner (backup hook, refusal on backup failure).

## 7. Keep item IDs as plan-line IDs during migration

- **Context:** entries point at `budget_item_id`.
- **Decision:** each old item becomes a plan line with the same id. Same-month duplicates merge into one line, and their entries move with them.
- **Why:** entries never have to be rewritten, so the migration can't detach them.
- **Decided by:** planner.

## 8. Merge categories: summed lines, preview first, backup always

- **Context:** after migrating, some categories are duplicates under different names or groups.
- **Decision:**
  - Merging A into B moves all lines and entries to B.
  - Same-month lines combine, with planned amounts summed.
  - A is deleted.
  - The UI shows the impact before writing and takes a backup first; the backup is the only undo.
- **Alternatives:** keep both lines; a built-in undo.
- **Why:** summing keeps the month's total plan unchanged, which a zero-based budget depends on. A full backup is simpler and safer than an undo log.
- **Decided by:** owner (merge semantics, in scope for this PR); planner (automatic backup).

## 9. Group visibility and lifecycle (rules A–G)

- **Context:** a review found that an empty new month showed no groups. Adding "Bills" there created a duplicate group, silently undoing the cross-month link this PR exists for.
- **Decision:** groups behave like categories:
  - every active group shows in every month
  - adding by name reuses (and un-archives) a group
  - renaming into an existing name is refused
  - deleting from a month archives the group if other months use it, or deletes it otherwise
  - emptied groups are deleted
  - the migration archives groups missing from the newest month
- **Alternatives:**
  - Show only groups with lines in the month, which leads to the duplicate-group bug.
  - A per-month membership table.
- **Why:** this is the simplest rule set that never creates duplicates and never shows retired groups.
- **Decided by:** planner, after the reviewer flagged the gap.

## 10. Drop cached months after any edit

- **Context:** the renderer caches every visited month. With shared groups and categories, an edit in October made the cached September tree stale.
- **Decision:** after an edit, keep only the edited and active months, and refetch the others on their next visit.
- **Alternatives:** patch every cached tree in place.
- **Why:** correct by construction, and the cost is one fetch per revisited month.
- **Decided by:** planner (a bug the review found).
