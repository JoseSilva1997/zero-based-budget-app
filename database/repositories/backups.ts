/* ============================================================
   Backup file operations.

   - createDbBackup uses better-sqlite3's online backup API for a consistent
     snapshot (safe even with WAL in flight).
   - restoreFromFile copies a chosen backup over the live DB file. The caller
     MUST close the connection first and reopen after.
   - pruneBackups keeps a rolling maximum (default 30), oldest first.
   ============================================================ */
import type Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { BackupInfo } from '../../shared/types';

const PREFIX = 'budget-';
const SUFFIX = '.sqlite';
export const MAX_BACKUPS = 30;

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
      /* ignore — best-effort prune */
    }
  }
}

/**
 * Overwrites the live DB file with a backup. The connection must already be
 * closed. Sidecar WAL/SHM files are removed so the restored file is canonical.
 */
export function restoreFromFile(backupFilePath: string, liveDbPath: string): void {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file not found: ${backupFilePath}`);
  }
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
