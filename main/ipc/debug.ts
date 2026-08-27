/* ============================================================
   Dev-only debug tools. registerDebugIpc() is called from ipc/index.ts ONLY
   when the app is unpackaged, so neither channel below exists in a shipped
   build. The renderer half is renderer/DebugMenu.jsx, which is itself gated on
   NODE_ENV === 'development' and so only appears under `npm run dev`.

   Full-page capture, and why it is not page.screenshot({ fullPage: true }):
   this app's scrolling happens inside .main (overflow-y: auto in app.css) -
   the document itself never overflows. Anything that measures the document
   sees no extra height and silently returns a plain viewport shot, clipped.
   So the renderer measures .main's own hidden overflow, hands the two numbers
   here, and this grows the real OS window by exactly that much, lets it
   reflow, takes one native capturePage(), and puts the window back. One real
   paint, no stitching. Same technique as
   .claude/skills/screenshot-app/full-page-capture.mjs, driven from inside the
   app instead of over Playwright.
   ============================================================ */
import { BrowserWindow, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { guard, guardAsync } from './envelope';
import { screenshotsDir } from '../paths';

/**
 * `house-budget-2026-08-15-142530-481.png`: sortable by name, and carrying
 * milliseconds because seconds alone are not enough - two captures fired in
 * quick succession collided on one filename, and the second silently
 * overwrote the first.
 */
function shotName(now = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}` +
    `-${p(now.getMilliseconds(), 3)}`;
  return `house-budget-${stamp}.png`;
}

/**
 * Grow the window by the renderer's hidden overflow, capture it, restore it.
 * Exported for tests/debug-screenshot-electron.cjs, which drives it against a
 * real BrowserWindow without going through IPC.
 *
 * @returns absolute path of the written PNG
 */
export async function captureWindow(
  win: BrowserWindow,
  extraW = 0,
  extraH = 0
): Promise<string> {
  const [origWidth, origHeight] = win.getSize();
  const growW = Math.max(0, Math.round(extraW));
  const growH = Math.max(0, Math.round(extraH));

  try {
    if (growW || growH) {
      win.setSize(origWidth + growW, origHeight + growH);
      // One frame for the resize to land, a second for layout and paint to
      // settle on top of it. Capturing before this returns a torn image.
      await win.webContents.executeJavaScript(
        'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
      );
    }
    const image = await win.webContents.capturePage();
    const file = path.join(screenshotsDir(), shotName());
    fs.writeFileSync(file, image.toPNG());
    return file;
  } finally {
    // In a finally so a failed capture cannot strand the window oversized.
    if (growW || growH) win.setSize(origWidth, origHeight);
  }
}

export function registerDebugIpc(): void {
  ipcMain.handle('debug:screenshot', async (event, payload: { extraW?: number; extraH?: number }) =>
    guardAsync(async () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) throw new Error('no window to capture');
      const file = await captureWindow(win, payload?.extraW ?? 0, payload?.extraH ?? 0);
      return { path: file };
    })
  );

  ipcMain.handle('debug:reveal', (_event, payload: { path: string }) =>
    guard(() => {
      shell.showItemInFolder(payload.path);
      return { ok: true as const };
    })
  );
}
