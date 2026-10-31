# Docs

What each feature does, and why it was built the way it was. Features get one living document each. A change with real design choices also gets a key-decisions file, named by date and slug.

Work is committed straight to `staging` (see [CLAUDE.md](../CLAUDE.md)). Until 2026-10-30 features went through pull requests into `staging`, and each got snapshot documents named after its PR number; those stay as they are, listed under **Pull requests (until 2026-10-30)**.

## Start here

New to the codebase? Read the **feature** docs first; they explain a whole feature and link every change that built it. Read a **decisions** file only when you need to know why.

### Features

| Feature | Doc | Changes |
|---|---|---|
| Categories | [categories](features/categories_feature.md) | #32 |
| Dashboard | [dashboard](features/dashboard_feature.md) | cards, swap, titles, spending by group |
| Upload transactions | [upload-transactions](features/upload-transactions_feature.md) | #32, #33, #37, #47, refunds |

### Decisions

| Date | Change | Feature | Decisions |
|---|---|---|---|
| 2026-10-30 | Develop directly on `staging`; PRs only for releases | Workflow | [decisions](key-decisions/2026-10-30-direct-to-staging_decisions.md) |
| 2026-10-31 | Refunds and money back | Upload transactions | [decisions](key-decisions/2026-10-31-refunds_decisions.md) |
| 2026-10-31 | Lock transfers | Upload transactions | [decisions](key-decisions/2026-10-31-lock-transfers_decisions.md) |
| 2026-10-31 | Dashboard cards | Dashboard | [decisions](key-decisions/2026-10-31-dashboard-cards_decisions.md) |
| 2026-10-31 | Dashboard card swap | Dashboard | [decisions](key-decisions/2026-10-31-dashboard-card-swap_decisions.md) |
| 2026-10-31 | Dashboard card titles | Dashboard | [decisions](key-decisions/2026-10-31-dashboard-card-titles_decisions.md) |
| 2026-10-31 | Dashboard spending by group | Dashboard | [decisions](key-decisions/2026-10-31-dashboard-spending-by-group_decisions.md) |

### Pull requests (until 2026-10-30)

| PR | Feature | Overview | Spec | Decisions |
|---|---|---|---|---|
| [#32](https://github.com/JoseSilva1997/zero-based-budget-app/pull/32) | Month-independent categories | [overview](pr-overview/pr32-categories_overview.md) | [spec](specs/pr32-categories_spec.md) | [decisions](key-decisions/pr32-categories_decisions.md) |
| [#33](https://github.com/JoseSilva1997/zero-based-budget-app/pull/33) | Upload transactions from bank statements | [overview](pr-overview/pr33-upload-transactions_overview.md) | [spec](specs/pr33-upload-transactions_spec.md) | [decisions](key-decisions/pr33-upload-transactions_decisions.md) |
| [#34](https://github.com/JoseSilva1997/zero-based-budget-app/pull/34) | This docs structure | [overview](pr-overview/pr34-docs-structure_overview.md) | — | — |
| [#37](https://github.com/JoseSilva1997/zero-based-budget-app/pull/37) | Upload review improvements | [overview](pr-overview/pr37-upload-review_overview.md) | — | [decisions](key-decisions/pr37-upload-review_decisions.md) |
| [#42](https://github.com/JoseSilva1997/zero-based-budget-app/pull/42) | A database from a newer version | [overview](pr-overview/pr42-newer-database_overview.md) | [spec](specs/pr42-newer-database_spec.md) | [decisions](key-decisions/pr42-newer-database_decisions.md) |
| [#43](https://github.com/JoseSilva1997/zero-based-budget-app/pull/43) | Dev launches keep their own data folder | [overview](pr-overview/pr43-dev-data-folder_overview.md) | — | — |
| [#44](https://github.com/JoseSilva1997/zero-based-budget-app/pull/44) | Restoring a backup from a newer version | [overview](pr-overview/pr44-restore-newer-backup_overview.md) | — | — |
| [#47](https://github.com/JoseSilva1997/zero-based-budget-app/pull/47) | Lloyds exports with chosen columns, and Monzo's shorter export | [overview](pr-overview/pr47-bank-export-variants_overview.md) | — | — |

Add a row here in the same commit that adds a decisions file.

## The kinds of file

| Folder | File | What it is | Kept up to date? |
|---|---|---|---|
| `features/` | `<feature>_feature.md` | The whole feature at overview level: context, what it does, how it works, the changes that built it, and a changelog. | **Yes, living.** Updated by every change to the feature. |
| `key-decisions/` | `<YYYY-MM-DD>-<slug>_decisions.md` | Each significant choice in one change: context, decision, alternatives, why, and who decided. | No, a snapshot when committed. |
| `pr-overview/`, `specs/`, and `key-decisions/pr<N>-…` | `pr<N>-<feature>_<overview\|spec\|decisions>.md` | History: one PR each, from before 2026-10-30. No new ones. | No, snapshots. |

## Rules

- **Which changes need docs.** Every change to a feature updates its feature doc **in the same commit**: the body so it describes the feature as it now stands, the **Changes** list when it is a notable change, and a **Changelog** row. A change with real design choices also gets a decisions file. Dependabot bumps, release PRs and trivial changes need neither.
- **Naming.**
  - Decisions: `<YYYY-MM-DD>-<slug>_decisions.md`, e.g. `2026-11-02-split-entries_decisions.md`: the day it was committed and a short kebab-case name.
  - Feature files: `<feature-kebab>_feature.md`, e.g. `categories_feature.md`.
- **Decisions files are snapshots.** They describe the change as committed and are not rewritten later; fix only mistakes. A later change that revisits a decision gets its own file, which links back. Every decisions file starts with a **Related** line linking its feature doc and any earlier decisions it builds on.
- **Who did what.** Name people by role, not by name:
  - **Engineer**: the person who worked on the feature.
  - Agents by role with an "Agent" suffix, e.g. **Planner Agent**, **Coding Agent**, **Reviewer Agent**, **Tester Agent**.
- **Diagrams.** Use [Mermaid](https://mermaid.js.org/) code blocks. GitHub renders them, and they diff like text. Draw one wherever a picture explains a data model, pipeline or flow faster than prose.
- **Release PR descriptions.** What ships to users, linking the feature docs and decisions files. The detail lives here, not on GitHub.
- **No real personal or financial data.** This repo is public. Names, merchants, towns, account and card numbers, references and amounts in docs, fixtures and tests must be invented. Never copy them from real statements or a real database.

## Templates

Readers know what House Budget is in general terms: a desktop zero-based budgeting app with monthly plan lines and actual entries. Don't explain that; start from the context of the change.

**Feature**: overview level, kept current.
1. Context: the problem, or what the Engineer wanted and why
2. What it does, for the user, in plain words
3. How it works, with at least one diagram
4. Where the code lives
5. Limits and what's parked
6. Changes: the notable changes that built the feature, oldest first, one line each, linking a decisions file or (for older ones) a PR overview
7. Changelog: date, PR or commit, what changed

**Decisions**: one section per decision.
- **Context**: the situation that forced a choice
- **Decision**: what was chosen
- **Alternatives**: what else was considered
- **Why**: the reason it won
- **Decided by**: the Engineer, or the agent by role (e.g. Planner Agent)
