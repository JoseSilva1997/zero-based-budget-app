# Feature workflow

How a feature goes from an idea to merged PRs in this repo. The workflow itself is the same in both modes. The mode skill that sent you here (`feature-workflow` or `feature-workflow-afk`) decides which **gates** stop for the Engineer and who settles open questions. Read it first if you haven't.

## Roles

- **Engineer**: the person. Owns product decisions, approves every outward step, merges.
- **Planner Agent**: you, the main session. You plan, write briefs, dispatch agents, verify their work, settle questions within your mode, and write the docs. You build nothing large yourself; a one-line fix while verifying is fine.
- **Coding Agent**: builds one slice, test-first.
- **Reviewer Agent**: reviews a finished PR branch, fixes real bugs test-first, and lists judgement calls.

Dispatch agents with the Agent tool: `model: "opus"`, `effort: "medium"`, `run_in_background: false`, one at a time. Slices on one branch touch overlapping files, so they never run in parallel. To follow up with an agent that has the context, use `SendMessage` to its agent id; a fresh dispatch starts cold.

## Gates

A **gate** is a point where the mode decides whether to stop. At a stop, summarise what's done, what's verified and what's open, then end your turn and wait.

| Gate | Where |
|---|---|
| **slice gate** | After each slice is built and verified |
| **PR gate** | After each PR is pushed and its description finalised |
| **question gate** | When an agent returns open questions or judgement calls |
| **outward gate** | Before anything leaves this machine: push, open a PR, edit a PR, mark ready, retarget, close/reopen |

Run each outward action as **its own command**, never bundled with others. Never merge a PR: the Engineer merges.

## 1. Shape (always with the Engineer)

Run the `mattpocock-skills:grilling` skill on the idea: rounds of numbered questions, each with your recommended answer. Look up facts yourself (code, schema, sample files, a copy of the database) and put only decisions to the Engineer.

**Done when** the Engineer confirms you share an understanding. The afk mode starts after this point, because shaping needs the Engineer.

## 2. Plan the PRs

1. Split the work into PRs. Groundwork goes first, as its own PR (e.g. a refactor the feature needs). Each PR should be reviewable on its own.
2. For each PR, list its **slices**: coherent units one Coding Agent can build and test in one go (e.g. schema + migration + repository; engine; UI).
3. Show the Engineer the PR list, the slices and the branch plan, then hit an **outward gate** to open one **draft PR per PR**:
   - Branch from `staging`. A PR that depends on another stacks on that PR's branch, and its draft PR targets that branch.
   - First commit: the spec's **original plan**, sections 1–7 per the template in `docs/README.md`, as `docs/specs/pr-next-<feature>_spec.md`. Push the branch and open the draft PR into its base; the PR number is `<N>`. Then `git mv` the file to `pr<N>-<feature>_spec.md` and commit.
   - Ask approval for all the draft PRs in one go; the Engineer is present right after shaping.

**Done when** every planned PR has a draft PR number and a committed original plan.

## 3. Build, slice by slice

For each slice, in order:

1. Write the Coding Agent's brief from the template in [feature-workflow-briefs.md](feature-workflow-briefs.md). Fill in everything the agent can't know: which spec section, what earlier slices built (commits, functions, IPC contracts), and decisions already made.
2. Dispatch it, and read its report.
3. **Verify, never trust the report:**
   - Run the full suite yourself: `npm test` (several minutes; unset `ELECTRON_RUN_AS_NODE`).
   - A schema change: run the migration against a **copy** of the real database in the scratchpad (from `~/.config/house-budget/data/`, with its `-wal`/`-shm` files). Compare row counts and money totals before and after, plus `foreign_key_check` and `integrity_check`. Never open the real database in place.
   - UI: look at the agent's screenshots yourself, or take them with the `screenshot-app` skill.
   - Grep the slice's diff for real personal data (see Privacy).
4. Settle the slice's open questions within your mode (**question gate**). Send fixes back to the same agent with `SendMessage`.
5. **Slice gate.**

**Done when** the PR's slices are built, verified and committed, and `npm test` is green.

## 4. Review the PR

Dispatch a fresh Reviewer Agent with the review brief from [feature-workflow-briefs.md](feature-workflow-briefs.md), pointing it at the whole PR diff (`git diff staging...HEAD`, or `<base branch>...HEAD` for a stacked PR). Add any change you've already decided as "Part 1".

Read its report. Settle its judgement calls within your mode (**question gate**) and send the decided fixes back to it. Then verify again as in step 3.

**Done when** every real bug is fixed with a test, every judgement call is decided, and `npm test` is green.

## 5. Document the PR

Follow `docs/README.md`. Before the PR is pushed for review:

- **Spec:** update sections 1–7 to describe what was built. Add **8. Changes from the original plan** (a table of each change, why, and which role made it) and **9. Original plan**: the first committed version, unedited, with any real data replaced.
- **Decisions:** `docs/key-decisions/pr<N>-<feature>_decisions.md`. One section per significant choice: context, decision, alternatives, why, decided by (Engineer, or an agent role).
- **Overview:** `docs/pr-overview/pr<N>-<feature>_overview.md`. Start with **Context**, include at least one Mermaid diagram, and assume the reader knows the app but not this change.
- **Feature doc:** create or update `docs/features/<feature>_feature.md` so it describes the feature as it now stands. Add the PR to its list and a changelog row.
- **Index:** add or update the rows in `docs/README.md`.
- Check that every relative link resolves.

**Done when** all five are committed and the links resolve.

## 6. Ship the PR

1. Run the **privacy check** on the whole branch history (`git log -p <base>..HEAD`), not just the final diff.
2. **Outward gate:** push the branch.
3. **Outward gate:** set the PR description to a short summary plus links to its docs, then mark it ready for review. Use absolute links to `staging` (`https://github.com/JoseSilva1997/zero-based-budget-app/blob/staging/docs/...`); relative links don't resolve in a PR description. Use the REST API for edits (see Gotchas).
4. Read CI once with `gh pr checks <N>`, or use the app's PR status. Don't poll.
5. **PR gate.** Then start the next PR at step 3.

After the last PR, tell the Engineer the merge order. Stacked PRs merge base-first; after a base merges, retarget its dependants to `staging` (outward gate) and get CI to run (see Gotchas).

## Privacy

This repo is public. Real statements live in the gitignored `bank_statements/`; the real database lives in `~/.config/house-budget/`.

- Fixtures, tests, docs and commit messages use **invented** data: names, merchants, towns, postcodes, account and card numbers, references, amounts and balances. Swapping names alone does not anonymise a statement row.
- Agents may read real files only from local scratch scripts, and report aggregate counts only.
- Before every push, grep the branch history for real values from those files: account numbers, card last-4s, sort codes, merchant names, towns.
- If real data is in **unpushed** commits: back the branch up locally, rewrite it with `git filter-branch --tree-filter` over `<base>..HEAD`, verify 0 hits and a green suite, then delete the backup refs. Pushed history is never rewritten; tell the Engineer instead.

## Gotchas

- `gh pr edit` fails on this machine's `gh` (2.45, "Projects (classic) is being deprecated"). Use `gh api -X PATCH repos/JoseSilva1997/zero-based-budget-app/pulls/<N> -F body=@<file>` (or `-f base=staging`).
- CI (`ci.yml`) runs on `opened`, `synchronize` and `reopened`, not on `edited`. A retargeted PR gets no CI run until it's closed and reopened (outward gate), or a commit is pushed.
- GitHub's "checking for the ability to merge" banner can stick after a retarget. Check `gh api …/pulls/<N> --jq .mergeable_state`; reloading the page fixes it.
- The repo's rules in `CLAUDE.md` apply throughout: PRs go into `staging`, never `main`; never bump `version`; never push `v*` tags.
