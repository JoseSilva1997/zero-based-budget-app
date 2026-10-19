# Docs

What each pull request built, why, and how. Every substantial PR leaves three files behind, named after its PR number, so you can go from a PR to its docs, or from a file to its PR, without searching.

## Start here

New to the codebase? Read the **overviews** in order. They assume no other context. Open the spec and decisions for a PR only when you need the detail.

| PR | Feature | Overview | Spec | Decisions |
|---|---|---|---|---|
| [#32](https://github.com/JoseSilva1997/zero-based-budget-app/pull/32) | Month-independent categories | [overview](pr-overview/pr32-categories_overview.md) | [spec](specs/pr32-categories_spec.md) | [decisions](key-decisions/pr32-categories_decisions.md) |
| [#33](https://github.com/JoseSilva1997/zero-based-budget-app/pull/33) | Upload transactions from bank statements | [overview](pr-overview/pr33-upload-transactions_overview.md) | [spec](specs/pr33-upload-transactions_spec.md) | [decisions](key-decisions/pr33-upload-transactions_decisions.md) |
| [#34](https://github.com/JoseSilva1997/zero-based-budget-app/pull/34) | This docs structure | [overview](pr-overview/pr34-docs-structure_overview.md) | — | — |

Add a row here in the same PR that adds the files.

## The three kinds of file

| Folder | File | What it is | Who reads it |
|---|---|---|---|
| `pr-overview/` | `pr<N>-<feature>_overview.md` | A short, high-level explanation of the PR: what it does, why, how it works (with diagrams), where the code lives, and its limits. | Any engineer, with no other context. |
| `specs/` | `pr<N>-<feature>_spec.md` | The detailed plan, written before the code: scope, data model, behaviour rules, UI, edge cases, test plan. | Whoever builds or reviews the PR. |
| `key-decisions/` | `pr<N>-<feature>_decisions.md` | Each significant choice: context, decision, alternatives, why, and who made it. | Anyone asking "why is it like this?" |

## Rules

- **Which PRs need docs.** Feature PRs and non-trivial fixes get all three files. A small fix gets an overview only, and no empty decisions file. Dependabot bumps, release PRs (`staging` → `main`) and trivial changes need none.
- **Naming.** Use `pr<N>-<feature-kebab>_<spec|decisions|overview>.md`, e.g. `pr32-categories_spec.md`. The number has no zero padding; the table above sets the order.
- **Getting the number.** Open a **draft PR first**, with the spec as its first commit, then name the files with that PR's number. Don't guess the next number: Dependabot takes numbers too.
- **One design across several PRs.** Split it into one spec per PR. Each spec links to the others.
- **Snapshots, not living docs.** A PR's files describe the PR as it merged and are not rewritten later; fix only mistakes. When a later PR changes a feature, its own docs say so and link back. Every file starts with a **Related** line linking earlier and later PRs.
- **Diagrams.** Use [Mermaid](https://mermaid.js.org/) code blocks. GitHub renders them, and they diff like text. Draw one wherever a picture explains a data model, pipeline or flow faster than prose.
- **PR descriptions.** A short summary plus links to the three files. The detail lives here, not on GitHub.
- **No real personal or financial data.** This repo is public. Names, merchants, towns, account and card numbers, references and amounts in docs, fixtures and tests must be invented. Never copy them from real statements or a real database.

## Templates

**Overview**: one to two screens.
1. What it does, for the user, in plain words
2. Why it exists
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

**Decisions**: one section per decision.
- **Context**: the situation that forced a choice
- **Decision**: what was chosen
- **Alternatives**: what else was considered
- **Why**: the reason it won
- **Decided by**: the owner, or the planner (the agent running the work)
