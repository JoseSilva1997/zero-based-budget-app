# PR 42 key decisions: a database from a newer version

**Related:** [overview](../pr-overview/pr42-newer-database_overview.md) · [spec](../specs/pr42-newer-database_spec.md)

**Engineer** is the person who worked on the change. The **Coding Agent** built it from the Engineer's brief.

## 1. Refuse in `initDb`, before any pragma

- **Context:** the version check existed but only warned, after pragmas and migrations had already run.
- **Decision:** read `user_version` straight after opening; if it is above `LATEST_VERSION`, close the connection and throw `DatabaseTooNewError` with both versions.
- **Alternatives:** keep warning and catch the resulting SQL error later; open read-only.
- **Why:** the first failing query is arbitrary and its message misleading. Setting WAL rewrites the file header, and a newer build's file should be left exactly as found. Read-only opening fails on a missing file, which is the fresh-install case.
- **Decided by:** Engineer (stop before any query); Coding Agent (before the pragmas).

## 2. Keep starting after the refusal

- **Context:** `initDb` runs first in `whenReady`; a throw there would stop the window, IPC and updater from starting.
- **Decision:** `main/index.ts` catches `DatabaseTooNewError` only, and starts the window, IPC and updater as usual. The renderer's first read gets the same refusal. `before-quit` skips its backup when no database is open.
- **Alternatives:** a native error dialog and quit.
- **Why:** updating is the fix, and the updater runs in this process. Quitting would also remove the way to update.
- **Decided by:** Engineer (the updater must still offer the update); Coding Agent (how).

## 3. The refusal crosses the bridge as a value

- **Context:** `contextBridge` drops custom properties on errors, so the renderer would only see a message string.
- **Decision:** the preload's `bootstrap` returns `{ status: 'db_too_new', found, supported }`, and the store rethrows it as a coded `Error`. This is the same pattern `importAddFile` uses for `needs_bank`.
- **Alternatives:** match on the error message in the renderer; a separate IPC channel for the startup error.
- **Why:** it reuses the envelope's existing `code` and `detail` and a pattern already in the codebase. Matching text breaks when the copy changes.
- **Decided by:** Coding Agent.

## 4. The update banner on the error card

- **Context:** the update banner lives in the sidebar, which does not render when startup fails.
- **Decision:** the startup error screen, moved to `renderer/StartupError.jsx`, mounts `UpdateBanner` for the newer-version case only.
- **Alternatives:** tell the user to download the release by hand.
- **Why:** it reuses the banner's download and restart flow unchanged, and it draws nothing until a release has been found.
- **Decided by:** Coding Agent.
