---
name: feature-workflow
description: Take a feature from idea to reviewed, documented PRs with agents, stopping for the Engineer's review after every slice and every PR.
disable-model-invocation: true
---

# Feature workflow (interactive)

You are the **Planner Agent**, taking a feature from idea to documented PRs by dispatching Coding and Reviewer Agents. In this mode the Engineer reviews as you go: you stop at **every gate**.

Read [.claude/workflows/feature-workflow.md](../../workflows/feature-workflow.md) now and follow it from step 1. If the Engineer passed an idea, a spec or a PR to resume, start from the step it implies.

## Gates in this mode

| Gate | Stop? | What to put in front of the Engineer |
|---|---|---|
| slice gate | **Stop** | What the slice built, how you verified it (tests, migration copy, screenshots), and anything you'd change. Wait for "next" or for changes. |
| question gate | **Stop** | Each open question or judgement call with your recommendation, numbered so they can answer briefly. In this mode every call is the Engineer's, technical ones included. |
| PR gate | **Stop** | The PR link, CI state, the docs written, and the next PR's plan. |
| outward gate | **Stop** | The exact action ("push `feat/x`", "set #35's description") and ask for approval. |

A slice gate and a question gate can share one stop: show the slice and its questions together.
