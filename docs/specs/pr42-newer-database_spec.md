# PR 42 spec: a database from a newer version

**Related:** [overview](../pr-overview/pr42-newer-database_overview.md) · [decisions](../key-decisions/pr42-newer-database_decisions.md)

Sections 1–8 describe what was built. Section 9 keeps the original plan as first committed.

## 1. Goal

When House Budget opens a database whose `user_version` is higher than its own `LATEST_VERSION`, it stops before running anything on it and says so on the startup error screen, with both versions and the way to update.

## 2. Scope and non-goals

**In scope:** the startup open (`initDb`), the startup error screen, and keeping the updater and quit working from that state.

**Non-goals (parked):** restoring a newer version's backup from Settings (`inspectBackupFile` doesn't check the version); a database whose version is *lower* than expected after migrating, which still only warns.

## 3. Data model

None. `user_version` is read and nothing is written.

## 4. Behaviour rules

- `initDb` reads `user_version` first, before `applyConnectionPragmas`. Above `LATEST_VERSION`: close the connection, throw `DatabaseTooNewError` (`code: 'db_too_new'`, `detail: { found, supported }`). Every later `getDb()` call opens, checks and refuses again; no connection is kept.
- `main/index.ts` catches only that error at startup and carries on: IPC, menu, window, updater and cloud catch-up all start. Any other `initDb` failure still throws as before.
- `before-quit` skips backup-on-close and `closeDb` when `isDbOpen()` is false.
- The preload's `bootstrap` returns `DbTooNew` for that code; the store throws it as an `Error` with `code`, `found` and `supported`, which becomes `fatal`.
- `main/updater.ts` has no database dependency, which was checked: `initUpdater`, `checkForUpdates`, `downloadUpdate` and `installUpdate` touch only electron-updater and the window.

## 5. UI

`renderer/StartupError.jsx` (moved out of `main.jsx`). For `db_too_new`:

- Title: "This budget is from a newer version"
- Body: "This budget was saved by a newer version of House Budget. Update the app to open it. Your budget file is still on this device, and nothing has been changed."
- Detail (mono): "Budget file: version 10. This version of House Budget reads up to version 7."
- `UpdateBanner` above the buttons, drawn once a release is found. "Try again" and "Open data folder" stay.

Any other error keeps the existing title, body and driver message, with no banner.

## 6. Edge cases

- **No update found** (offline, staging build, a dev build's schema): the card shows no banner. Parked.
- **Update installed from this state:** `quitAndInstall` fires `before-quit`, which now returns early instead of calling `getDb()` and throwing.
- **Try again:** re-runs bootstrap, which refuses the same way until the file or the app changes.

## 7. Test plan

`tests/newer-database-electron.cjs`, in `npm test` and `npm run test:core`:

- Main: a file database at `LATEST_VERSION + 3` with an unknown shape. `initDb` throws `DatabaseTooNewError` with both versions; afterwards the journal mode is still `delete`, the tables are unchanged and no backup exists. A second call refuses again, and `guard` carries `code` and `detail`. A current database still opens and answers queries.
- Renderer: the store with a fake `bootstrap` returning `DbTooNew` ends with a coded `fatal` and no state. The screen shows the new copy, both versions and the banner for it, and the generic copy, driver message and no banner for an `SQLITE_BUSY` error.

## 8. Changes from the original plan

- The screen moved to its own module, `renderer/StartupError.jsx`, so a test can mount it. `main.jsx` creates its root on import.
- The test builds its "current database" with the migration runner rather than through `initDb`'s fresh path, which reads `schema.sql` relative to the app path (`tests/` under the test runner).

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
