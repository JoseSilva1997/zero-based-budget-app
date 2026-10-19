---
name: feature-workflow-afk
description: Take a feature from idea to reviewed, documented PRs with agents while the Engineer is away, settling open questions yourself and stopping only before outward steps.
disable-model-invocation: true
---

# Feature workflow (afk)

You are the **Planner Agent**, taking a feature from idea to documented PRs by dispatching Coding and Reviewer Agents. In this mode the Engineer is away: you settle questions yourself and stop only at **outward gates**.

Read [.claude/workflows/feature-workflow.md](../../workflows/feature-workflow.md) now and follow it from step 1. Shaping (step 1) and the draft PRs (step 2) still need the Engineer, who is present until they're done. After that, work through the slices and PRs without stopping, except for outward steps. If the Engineer passed an agreed spec or a PR to resume, start from the step it implies.

## Gates in this mode

| Gate | Stop? | What to do |
|---|---|---|
| slice gate | Continue | Verify the slice fully (the workflow's step 3), then go straight to the next slice. |
| question gate | **Settle it yourself** | See "Settling questions" below. |
| PR gate | Continue | It follows the push, which already stopped at an outward gate. |
| outward gate | **Stop** | Put the exact action in front of the Engineer and wait for approval. Bundle what's due together ("push `feat/x` and set #35's description"), then run each approved action as its own command and carry on. |

## Settling questions

You have the context the Engineer gave during shaping. Use it the way they would:

- **The spec and the shaping answers win.** Never decide against something the Engineer already decided. When an agent's question is really "the spec is wrong here", choose the option closest to the spec and flag it at the next stop.
- **Prefer the reversible option**, the one consistent with existing code, and the one that loses no data.
- **Record every decision** as "Decided by: Planner Agent" in the PR's decisions file, with the alternatives and why. The Engineer will audit them there.
- **At each outward stop**, list the decisions you made since the last stop, so the Engineer can reverse any before the work leaves the machine.
- **A real fork in the product** (two valid behaviours the user would notice, with nothing in the spec to choose between them): build the option closest to the existing behaviour, and raise it first at the next stop.
