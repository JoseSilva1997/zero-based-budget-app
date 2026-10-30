# PR N spec: a database from a newer version

**Related:** [overview](../pr-overview/prN-newer-database_overview.md) · [decisions](../key-decisions/prN-newer-database_decisions.md)

## 9. Original plan

### Goal

When House Budget opens a database whose `user_version` is higher than its own `LATEST_VERSION`, it stops before running any query on it and says so plainly on the startup error screen, with both versions, instead of failing on the first missing column and blaming another window or a sync program.

### Why

A development build migrated a real database to schema 10. The installed release (schema 7) then failed with `no such column: budget_month_id` under "the app is already running in another window, or the file is being synced". The data was fine; the message was wrong. Releases ship through the auto-updater, so an older install meeting a newer database will happen again: a restored backup, or two machines sharing a synced folder.

### Plan

- `main/db.ts`: read `user_version` straight after opening, before any pragma, migration or backup. If it is above `LATEST_VERSION`, close the connection and throw a `DatabaseTooNewError` (`code: 'db_too_new'`, `detail: { found, supported }`). The IPC envelope already passes `code` and `detail` through.
- `main/index.ts`: catch that error at startup so the window, IPC handlers and updater still start. Make quitting safe when the database never opened.
- Preload `bootstrap`: turn the coded refusal into a value (as `needs_bank` does for uploads), since `contextBridge` drops custom error properties.
- Renderer: the store raises a coded error; the startup error screen shows a distinct title and body for it, the two versions as the detail, and the update banner, so the fix (updating) is one click away.
- `main/updater.ts`: confirm it does not depend on the database.

### Test plan

- An Electron test opens a file database with `user_version` above `LATEST_VERSION` through the real `initDb`, and asserts `DatabaseTooNewError` with both versions, that the journal mode was not switched to WAL, no backup was taken and the schema is untouched.
- A renderer test mounts the startup error screen with that error and asserts the new copy and versions, and that the generic copy still shows for any other error.
