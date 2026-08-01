/* ============================================================
   Application menu.

   Two jobs: give the repeated actions real accelerators, and make those
   accelerators discoverable. A shortcut nobody can find is not a shortcut, so
   every keystroke the app answers to is also a labelled menu item.

   Menu items don't act directly; they post a command to the renderer, which
   already owns the state these actions change.
   ============================================================ */
import { Menu, BrowserWindow, app, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { userDataDir } from './paths';

export type MenuCommand =
  | 'newMonth'
  | 'prevMonth'
  | 'nextMonth'
  | 'backupNow'
  | 'goDashboard'
  | 'goBudget'
  | 'goHistory'
  | 'goSettings';

function send(command: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', command);
}

const item = (
  label: string,
  accelerator: string,
  command: MenuCommand
): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(command) });

export function buildAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        item('New Month…', 'CmdOrCtrl+N', 'newMonth'),
        { type: 'separator' },
        item('Back Up Now', 'CmdOrCtrl+S', 'backupNow'),
        {
          label: 'Open Data Folder',
          click: () => { void shell.openPath(userDataDir()); },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&Go',
      submenu: [
        item('Dashboard', 'CmdOrCtrl+1', 'goDashboard'),
        item('Month Budget', 'CmdOrCtrl+2', 'goBudget'),
        item('History', 'CmdOrCtrl+3', 'goHistory'),
        item('Settings', 'CmdOrCtrl+4', 'goSettings'),
        { type: 'separator' },
        item('Previous Month', 'CmdOrCtrl+Left', 'prevMonth'),
        item('Next Month', 'CmdOrCtrl+Right', 'nextMonth'),
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({ role: 'appMenu', label: app.name });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
