# 2026-10-31 key decisions: lock transfers

**Related:** [upload transactions](../features/upload-transactions_feature.md)

**Engineer** is the person who works on the app. The **Coding Agent** built it.

A transfer row on the upload review had a tick that could be clicked but did nothing: a transfer writes nothing, so the tick fell straight back. The Engineer asked for a setting that makes transfers impossible to tick.

## 1. Unlocked, ticking a transfer imports it as a spend

- **Context:** with the setting off, the tick had to mean something, or the setting would only change how a dead control looks.
- **Decision:** ticking a transfer sends `{ kind: 'spend', included: true }`: the row is a spend again, ticked, and is imported once it has a category. The tick itself is never drawn checked on a transfer.
- **Alternatives:** keep the tick inert and let the setting only disable it.
- **Why:** a payment the classifier took for a transfer (money to a partner for a shared bill, say) is often spending, and the tick is where you say "import this". Unticking it again leaves it a spend, unticked; Transfer in the row's menu makes it a transfer again.
- **Decided by:** Engineer.

## 2. The switch sits on the review, and is remembered

- **Context:** it could live in Settings or on the review.
- **Decision:** a **Lock transfers** chip above the list, on the right of the filter chips, drawn like them (pressed, not coloured). It is stored in `app_meta` as `lockTransfers` (`'1'`/`'0'`, absent means off) through `settings:update`, like `sidebarCollapsed`, and is not part of a backup.
- **Alternatives:** a switch in Settings; a per-upload choice.
- **Why:** it is used while reviewing, where its effect is seen at once; remembering it saves setting it on every upload. It is a preference about the review, not budget data, so a backup does not carry it.
- **Decided by:** Engineer chose the place; Coding Agent chose the storage and the drawing.
