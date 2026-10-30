# Docs

What each feature does, and what each pull request built, why and how. Features get one living document each. Pull requests get three snapshot documents, named after the PR number, so you can go from a PR to its docs, or from a file to its PR, without searching.

## Start here

New to the codebase? Read the **feature** docs first; they explain a whole feature and link every PR that built it. Read a PR's **overview** to understand that one change, and its spec and decisions only when you need the detail.

### Features

| Feature | Doc | PRs |
|---|---|---|
| Categories | [categories](features/categories_feature.md) | #32 |
| Upload transactions | [upload-transactions](features/upload-transactions_feature.md) | #32, #33, #37, #47 |

### Pull requests

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

Add or update rows here in the same PR that adds or changes the files.

## The four kinds of file

| Folder | File | What it is | Kept up to date? |
|---|---|---|---|
| `features/` | `<feature>_feature.md` | The whole feature at overview level: context, what it does, how it works, every PR that built it, and a changelog. | **Yes, living.** Updated by every PR that changes the feature. |
| `pr-overview/` | `pr<N>-<feature>_overview.md` | One PR at a high level, readable without other context. | No, a snapshot at merge. |
| `specs/` | `pr<N>-<feature>_spec.md` | One PR in detail: what was built, what changed from the plan, and the original plan. | No, a snapshot at merge. |
| `key-decisions/` | `pr<N>-<feature>_decisions.md` | Each significant choice in one PR: context, decision, alternatives, why, and who decided. | No, a snapshot at merge. |

## Rules

- **Which PRs need docs.** Feature PRs and non-trivial fixes get all three PR files. A small fix gets an overview only, and no empty decisions file. Dependabot bumps, release PRs (`staging` → `main`) and trivial changes need none.
- **Feature docs.** A PR that adds or changes a feature creates or updates its feature doc **in the same PR**: the body so it describes the feature as it now stands, the **PRs** list, and a **Changelog** row. A feature built over several PRs has one feature doc, not one per PR.
- **Naming.**
  - PR files: `pr<N>-<feature-kebab>_<spec|decisions|overview>.md`, e.g. `pr32-categories_spec.md`. The number has no zero padding; the tables above set the order.
  - Feature files: `<feature-kebab>_feature.md`, e.g. `categories_feature.md`.
- **Getting the number.** Open a **draft PR first**, with the spec's original plan as its first commit, then name the files with that PR's number. Don't guess the next number: Dependabot takes numbers too.
- **Original plan, then as built.**
  1. The spec starts as the plan.
  2. Before merging, update its sections to describe what was actually built.
  3. List what changed and why under "Changes from the original plan".
  4. Keep the plan as it was first committed, unedited, under "Original plan".
- **One design across several PRs.** Split it into one spec per PR. Each spec links to the others, and all of them link to the feature doc.
- **PR files are snapshots.** They describe the PR as it merged and are not rewritten later; fix only mistakes. When a later PR changes a feature, its own docs say so and link back. Every PR file starts with a **Related** line linking its feature doc and the earlier and later PRs.
- **Who did what.** Name people by role, not by name:
  - **Engineer**: the person who worked on the feature.
  - Agents by role with an "Agent" suffix, e.g. **Planner Agent**, **Coding Agent**, **Reviewer Agent**, **Tester Agent**.
- **Diagrams.** Use [Mermaid](https://mermaid.js.org/) code blocks. GitHub renders them, and they diff like text. Draw one wherever a picture explains a data model, pipeline or flow faster than prose.
- **PR descriptions.** A short summary plus links to the files. The detail lives here, not on GitHub.
- **No real personal or financial data.** This repo is public. Names, merchants, towns, account and card numbers, references and amounts in docs, fixtures and tests must be invented. Never copy them from real statements or a real database.

## Templates

Readers know what House Budget is in general terms: a desktop zero-based budgeting app with monthly plan lines and actual entries. Don't explain that; start from the context of the change.

**Feature**: overview level, kept current.
1. Context: the problem, or what the Engineer wanted and why
2. What it does, for the user, in plain words
3. How it works, with at least one diagram
4. Where the code lives
5. Limits and what's parked
6. PRs: every PR for the feature, oldest first, one line each
7. Changelog: date, PR, what changed

**PR overview**: one to two screens.
1. Context: the problem the PR solves or, when there isn't one, what the Engineer wanted to change and why
2. What it does, for the user, in plain words
3. How it works, with at least one diagram
4. Where the code lives
5. How to try it and test it
6. Limits and what's parked

**Spec**
1. Goal
2. Scope and non-goals
3. Data model
4. Behaviour rules
5. UI
6. Edge cases
7. Test plan
8. Changes from the original plan
9. Original plan (as first committed, unedited)

**Decisions**: one section per decision.
- **Context**: the situation that forced a choice
- **Decision**: what was chosen
- **Alternatives**: what else was considered
- **Why**: the reason it won
- **Decided by**: the Engineer, or the agent by role (e.g. Planner Agent)
