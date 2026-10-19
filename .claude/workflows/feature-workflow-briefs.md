# Agent briefs

Templates for the briefs in [feature-workflow.md](feature-workflow.md). An agent starts cold: it knows only what the brief says and what it can read. Fill every `<…>`, and write decisions as decided ("Make `kind` nullable"), not as options. Whatever you leave out, the agent will decide for itself.

## Coding Agent

```
You are building <slice> of "<feature>" in House Budget, an Electron + better-sqlite3 + React
zero-based budget app at /home/jose/repos/zero-based-budget-app, on branch `<branch>`.
Read CLAUDE.md, docs/README.md, and the spec docs/specs/pr<N>-<feature>_spec.md, section <…>.
<If UI:> Read DESIGN.md in full; it is binding.

## Already built
<Earlier slices and PRs: commits, tables, functions and their signatures, IPC channels and
payload shapes, file locations. Everything this slice builds on.>

## Your scope
<Exactly what to build. Decided details as decisions: schema columns, rules, refusal copy,
edge cases. What is explicitly out of scope, and which later slice owns it.>

## Process (mandatory)
- TDD: load the `mattpocock-skills:tdd` skill and follow it. Red → green → refactor, one
  behaviour at a time: write the test, run it and see it fail for the right reason, write the
  minimum code, see it pass. No implementation before its test. New test files go in the
  `test` (and, for non-UI suites, `test:core`) scripts in package.json.
- Build and test: `npm run build`, then `npx electron tests/<file>.cjs` (unset
  ELECTRON_RUN_AS_NODE). Full suite: `npm test`, green at the start and green at the end.
  <UI: `npm run build:renderer`; verify with the `screenshot-app` skill and look at the
  screenshots; save them under <scratchpad>/shots-<slice>/.>
- Commit after each green step, with conventional lowercase messages (`feat: …`, `test: …`,
  `fix: …`) and explicit `git add <paths>`. Never commit `docs/` (the Planner Agent writes
  the docs), `bank_statements/`, `build/` or screenshots. Never push, switch branches or bump
  the version.
- Data: fixtures and tests use invented names, merchants, towns, account and card numbers,
  references and amounts. You may read real files (bank_statements/, a COPY of the database
  in the scratchpad) only from throwaway scripts in <scratchpad>, and report aggregates only.
- Match the surrounding code: header comment blocks, comment density, naming, and refusal
  messages written as user-facing copy.

## Report (concise)
Commits (hash and subject); what you built and where; decisions you made that the brief
didn't specify, and why; open questions; `npm test` result; anything unverified, honestly.
```

## Reviewer Agent

```
You are an independent reviewer for branch `<branch>` of House Budget, an Electron +
better-sqlite3 + React zero-based budget app at /home/jose/repos/zero-based-budget-app.
Stay on that branch. Review `git diff <base>...HEAD`. Read CLAUDE.md, DESIGN.md and
docs/specs/pr<N>-<feature>_spec.md.

## What the branch does
<A summary of the PR: schema, rules, modules, UI.>

<Optional: ## Part 1: a change already decided
<The change, why, and how to do it test-first.>>

## Your job
Hunt for correctness bugs, data-loss risks and spec deviations, not style. Focus areas:
<The riskiest parts of this PR: migrations (fresh install vs migrated schema, idempotency,
totals preserved), transactions and undo, cross-month or cross-account leaks in queries,
refusal paths, stale renderer state and caches, edge cases from the spec.>
Also grep the whole diff for anything that looks like real personal data, and report hits
without printing them.

## Rules
- Each real bug: write a failing test reproducing it, see it fail, fix it, see it pass.
  One commit per fix (`fix: …`), explicit `git add <paths>`. Never commit `docs/`,
  `bank_statements/` or `build/`. Never push or switch branches.
- Judgement calls that aren't clearly bugs: leave them unchanged and list them.
- `npm test` green at the end.

## Report (concise)
Bugs fixed (hash and a one-line failure scenario each); judgement calls, each with your
recommendation; privacy grep result; `npm test` result.
```
