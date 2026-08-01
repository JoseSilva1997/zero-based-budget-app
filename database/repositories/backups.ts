/* ============================================================
   Backup file operations.

   - createDbBackup uses better-sqlite3's online backup API for a consistent
     snapshot (safe even with WAL in flight).
   - inspectBackupFile validates a candidate file BEFORE anything is
     overwritten: SQLite header, then a read-only open to confirm it is
     actually a House Budget database, then the counts the confirm dialogue
     needs. restoreFromFile refuses to copy anything that fails this.
   - restoreFromFile copies a chosen backup over the live DB file. The caller
     MUST close the connection first and reopen after.
   - pruneBackups keeps a rolling maximum (default 30), oldest first.
   ============================================================ */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { BackupInfo, BackupSummary, DbSummary } from '../../shared/types';

const PREFIX = 'budget-';
const SUFFIX = '.sqlite';
export const MAX_BACKUPS = 30;

/** Every SQLite file begins with this 16-byte string, NUL terminator included. */
const SQLITE_MAGIC = 'SQLite format 3\0';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Filesystem-safe, lexically-sortable timestamp, e.g. 2026-06-04T214530. */
function safeTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function friendlyDate(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export async function createDbBackup(
  db: Database.Database,
  backupsDir: string
): Promise<BackupInfo> {
  const now = new Date();
  const fileName = `${PREFIX}${safeTimestamp(now)}${SUFFIX}`;
  const dest = path.join(backupsDir, fileName);

  await db.backup(dest);
  pruneBackups(backupsDir);

  const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  return { path: dest, fileName, savedAt: friendlyDate(now), size };
}

export function listBackups(backupsDir: string): BackupInfo[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
    .map((fileName) => {
      const full = path.join(backupsDir, fileName);
      const stat = fs.statSync(full);
      return {
        path: full,
        fileName,
        savedAt: friendlyDate(stat.mtime),
        size: stat.size,
      };
    })
    .sort((a, b) => b.fileName.localeCompare(a.fileName)); // newest first
}

export function pruneBackups(backupsDir: string, keep = MAX_BACKUPS): void {
  const backups = listBackups(backupsDir); // newest first
  for (const old of backups.slice(keep)) {
    try {
      fs.unlinkSync(old.path);
    } catch {
      /* ignore - best-effort prune */
    }
  }
}

/** Row counts used to tell the user what a database actually holds. */
export function summariseDb(db: Database.Database): DbSummary {
  const months = db.prepare(`SELECT COUNT(*) AS n FROM budget_months`).get() as { n: number };
  const entries = db
    .prepare(`SELECT COUNT(*) AS n FROM budget_item_actual_entries`)
    .get() as { n: number };
  return { months: months.n, entries: entries.n };
}

/** True when the file's first 16 bytes are the SQLite magic string. */
function hasSqliteHeader(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    return read === 16 && buf.toString('latin1') === SQLITE_MAGIC;
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Validates a candidate restore file and reports what it contains. Throws a
 * message meant for a human if the file is not a House Budget database.
 * Nothing is written; this runs before the live DB is touched.
 */
export function inspectBackupFile(filePath: string): BackupSummary {
  if (!fs.existsSync(filePath)) {
    throw new Error("That file no longer exists. Pick another backup.");
  }
  if (!hasSqliteHeader(filePath)) {
    throw new Error(
      "That isn't a House Budget backup. Backups are .sqlite files created by this app."
    );
  }

  let conn: Database.Database | null = null;
  try {
    conn = new Database(filePath, { readonly: true, fileMustExist: true });
    const table = conn
      .prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master
         WHERE type = 'table' AND name = 'budget_months'`
      )
      .get() as { n: number };
    if (table.n === 0) {
      throw new Error(
        "That database isn't a House Budget backup - it has no budget months in it."
      );
    }
    const stat = fs.statSync(filePath);
    return {
      ...summariseDb(conn),
      path: filePath,
      fileName: path.basename(filePath),
      savedAt: friendlyDate(stat.mtime),
      size: stat.size,
    };
  } catch (err) {
    // better-sqlite3 throws on a truncated or corrupt file; say so plainly.
    if (err instanceof Error && err.message.startsWith("That ")) throw err;
    throw new Error("That backup file is damaged and can't be read.");
  } finally {
    conn?.close();
  }
}

/**
 * Overwrites the live DB file with a backup. The connection must already be
 * closed. The file is re-validated here rather than trusting the caller, so
 * this can never destroy the live database with something unreadable. Sidecar
 * WAL/SHM files are removed so the restored file is canonical.
 */
export function restoreFromFile(backupFilePath: string, liveDbPath: string): void {
  inspectBackupFile(backupFilePath);
  fs.copyFileSync(backupFilePath, liveDbPath);
  for (const sidecar of [`${liveDbPath}-wal`, `${liveDbPath}-shm`]) {
    if (fs.existsSync(sidecar)) {
      try {
        fs.unlinkSync(sidecar);
      } catch {
        /* ignore */
      }
    }
  }
}
