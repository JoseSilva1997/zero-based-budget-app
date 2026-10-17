/* ============================================================
   Cloud backup folder: file operations.

   The app never talks to a cloud service. It copies finished local snapshots
   into a folder the user's sync app (OneDrive, Dropbox, Nextcloud, an rclone
   mount, ...) already uploads. Local backups always come first: everything
   here runs on a snapshot that already exists in backupsDir(), and nothing
   here ever writes to or deletes from that folder.

   Layout, inside the folder the user picked:

     House Budget/              <- the root; this path is what gets saved
       .house-budget            <- marker
       <device>/budget-....sqlite

   - The marker is the guard against a folder that is not really there: an
     unmounted network drive or an unplugged disk leaves an empty local
     directory behind, and copying into it would put "cloud" backups on the
     local disk. No marker, no copy.
   - Each device writes only its own subfolder, so two machines sharing one
     cloud folder never collide and pruning one never touches the other.
   - Copies land as `.tmp` and are renamed into place, so a sync app never
     uploads a half-written file that would look like a real backup.
   ============================================================ */
import * as fs from 'fs';
import * as path from 'path';
import { listBackups, pruneBackups, MAX_BACKUPS } from './backups';
import type { ListedBackup } from '../../shared/types';

export const APP_FOLDER = 'House Budget';
export const MARKER = '.house-budget';
const TMP_SUFFIX = '.tmp';
/** A `.tmp` this old is a copy that was cut off (quit, crash, dropped mount). */
const STALE_TMP_MS = 60 * 60 * 1000;

export const NOT_READY =
  "Couldn't reach your cloud folder. Check that it's connected; the app will try again next time.";

/**
 * The root for a picked folder: the picked folder itself when it is already a
 * House Budget folder (a second machine pointed at the same place), else a
 * "House Budget" folder inside it.
 */
export function resolveCloudRoot(picked: string): string {
  return fs.existsSync(path.join(picked, MARKER)) ? picked : path.join(picked, APP_FOLDER);
}

/** Creates the root, proves it is writable and writes the marker. Returns the root. */
export function prepareCloudFolder(picked: string): string {
  let isDir = false;
  try {
    isDir = fs.statSync(picked).isDirectory();
  } catch {
    /* missing - reported below */
  }
  if (!isDir) throw new Error("That folder doesn't exist any more. Pick another one.");

  const root = resolveCloudRoot(picked);
  try {
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    const marker = path.join(root, MARKER);
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(
        marker,
        JSON.stringify({ app: 'House Budget', createdAt: new Date().toISOString() }) + '\n'
      );
    }
  } catch {
    throw new Error("House Budget can't save files in that folder. Pick one you can write to.");
  }
  return root;
}

export function isFolderReady(root: string | null): boolean {
  return !!root && fs.existsSync(path.join(root, MARKER));
}

/**
 * A device name that is a valid folder name on Windows and Linux alike.
 * Windows is the stricter of the two: no <>:"/\|?* or control characters, and
 * no trailing dot or space. A leading dot would hide the folder on Linux.
 */
export function safeDeviceName(raw: string): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .slice(0, 64);
  return cleaned || 'this-computer';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Windows sync apps and antivirus briefly lock a file they have just noticed. */
async function renameWithRetry(from: string, to: string, attempts = 3): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      await sleep(250 * i);
    }
  }
}

/**
 * Copies one local snapshot into this device's subfolder, then prunes that
 * subfolder. Throws NOT_READY when the marker is missing. Re-running it for a
 * file that is already there is a no-op, which is what makes catch-up cheap.
 */
export async function mirrorBackup(
  localFile: string,
  root: string,
  device: string,
  keep = MAX_BACKUPS
): Promise<'copied' | 'present'> {
  if (!isFolderReady(root)) throw new Error(NOT_READY);

  const dir = path.join(root, device);
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(localFile));

  const local = await fs.promises.stat(localFile);
  const existing = await fs.promises.stat(dest).catch(() => null);
  if (existing && existing.size === local.size) {
    pruneCloud(root, device, keep);
    return 'present';
  }

  const tmp = dest + TMP_SUFFIX;
  await fs.promises.copyFile(localFile, tmp);
  try {
    await renameWithRetry(tmp, dest);
  } catch {
    // Some network mounts cannot rename reliably. Writing the final name
    // directly loses only the half-written-file protection, and the size check
    // above repairs a cut-off copy on the next run.
    await fs.promises.copyFile(localFile, dest);
    await fs.promises.rm(tmp, { force: true });
  }
  // The list dates a backup by its modified time, so the copy keeps the
  // snapshot's own, not the time it was copied (which for a catch-up copy can
  // be days later). Best-effort: some mounts refuse it.
  await fs.promises.utimes(dest, local.atime, local.mtime).catch(() => {});
  pruneCloud(root, device, keep);
  return 'copied';
}

/**
 * Keeps this device's newest `keep` snapshots and clears cut-off `.tmp` files.
 * Only this device's subfolder, and only files named the way this app names
 * them, are ever touched.
 */
export function pruneCloud(root: string, device: string, keep = MAX_BACKUPS): void {
  const dir = path.join(root, device);
  if (!fs.existsSync(dir)) return;
  pruneBackups(dir, keep);
  const now = Date.now();
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('budget-') || !f.endsWith('.sqlite' + TMP_SUFFIX)) continue;
    const full = path.join(dir, f);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_TMP_MS) fs.unlinkSync(full);
    } catch {
      /* ignore - best-effort cleanup */
    }
  }
}

/**
 * Copies the newest local snapshots that the cloud folder is missing - the
 * ones made while it was unreachable. Oldest first, so pruning after each copy
 * keeps the newest. Returns how many were copied.
 */
export async function catchUp(
  localDir: string,
  root: string,
  device: string,
  keep = MAX_BACKUPS
): Promise<number> {
  if (!isFolderReady(root)) throw new Error(NOT_READY);
  const wanted = listBackups(localDir).slice(0, keep).reverse();
  let copied = 0;
  for (const b of wanted) {
    if ((await mirrorBackup(b.path, root, device, keep)) === 'copied') copied++;
  }
  return copied;
}

/** Every device's snapshots in the cloud folder, newest first. */
export function listCloudBackups(root: string | null): ListedBackup[] {
  if (!root || !isFolderReady(root)) return [];
  const out: ListedBackup[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      for (const b of listBackups(path.join(root, entry.name))) {
        out.push({ ...b, source: 'cloud', device: entry.name });
      }
    } catch {
      /* an unreadable device folder is skipped, not fatal */
    }
  }
  return out.sort((a, b) => b.fileName.localeCompare(a.fileName));
}

/** True when `file` sits inside `root`. */
export function isInside(file: string, root: string | null): boolean {
  if (!root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Copies a cloud snapshot to a local temp folder so validating and restoring
 * read a file the sync app cannot change underneath them. The file keeps its
 * name and modified time, so the confirm dialog shows the same date and name
 * as the list did. Each call clears the previous staged copy.
 */
export function stageForRestore(cloudFile: string, stagingRoot: string): string {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(stagingRoot, 'restore-'));
  const dest = path.join(dir, path.basename(cloudFile));
  try {
    fs.copyFileSync(cloudFile, dest);
  } catch {
    throw new Error("That backup couldn't be read from your cloud folder. Check that it's connected.");
  }
  const st = fs.statSync(cloudFile);
  fs.utimesSync(dest, st.atime, st.mtime);
  return dest;
}
