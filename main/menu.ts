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
import type { ShortcutDoc } from '../shared/types';
import { userDataDir } from './paths';

export type MenuCommand =
  | 'newMonth'
  | 'prevMonth'
  | 'nextMonth'
  | 'backupNow'
  | 'goDashboard'
  | 'goBudget'
  | 'goHistory'
  | 'goSettings'
  | 'checkUpdates'
  | 'openFind';

/**
 * Every accelerator the app defines, in one place. The menu is built from
 * this and so is the Shortcuts section in Settings, so the two cannot drift.
 * Menu entries without a keystroke (Open Data Folder, Check for Updates…)
 * are not accelerators and stay inline in the template below.
 */
type Accelerator = {
  group: string;
  label: string;
  accelerator: string;
  command: MenuCommand;
};

const ACCELERATORS: Accelerator[] = [
  { group: 'Actions', label: 'New Month…', accelerator: 'CmdOrCtrl+N', command: 'newMonth' },
  { group: 'Actions', label: 'Back Up Now', accelerator: 'CmdOrCtrl+S', command: 'backupNow' },
  { group: 'Actions', label: 'Find…', accelerator: 'CmdOrCtrl+F', command: 'openFind' },
  { group: 'Navigation', label: 'Dashboard', accelerator: 'CmdOrCtrl+1', command: 'goDashboard' },
  { group: 'Navigation', label: 'Month Budget', accelerator: 'CmdOrCtrl+2', command: 'goBudget' },
  { group: 'Navigation', label: 'History', accelerator: 'CmdOrCtrl+3', command: 'goHistory' },
  { group: 'Navigation', label: 'Settings', accelerator: 'CmdOrCtrl+4', command: 'goSettings' },
  { group: 'Navigation', label: 'Previous Month', accelerator: 'CmdOrCtrl+Left', command: 'prevMonth' },
  { group: 'Navigation', label: 'Next Month', accelerator: 'CmdOrCtrl+Right', command: 'nextMonth' },
];

function send(command: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', command);
}

/** Menu entry for an accelerator, looked up by the command it posts. */
const item = (command: MenuCommand): MenuItemConstructorOptions => {
  const a = ACCELERATORS.find((x) => x.command === command);
  if (!a) throw new Error(`No accelerator defined for menu command "${command}"`);
  return { label: a.label, accelerator: a.accelerator, click: () => send(command) };
};

/**
 * The same accelerators, ready to render: Electron's platform-agnostic tokens
 * resolved to what this machine's keyboard actually says. The renderer has no
 * access to process.platform, so the conversion belongs here.
 */
export function shortcutDocs(): ShortcutDoc[] {
  const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl';
  return ACCELERATORS.map((a) => ({
    group: a.group,
    label: a.label,
    keys: a.accelerator
      .replace('CmdOrCtrl', mod)
      .replace('Left', '←')
      .replace('Right', '→')
      .split('+'),
  }));
}

export function buildAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        item('newMonth'),
        { type: 'separator' },
        item('backupNow'),
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
        item('openFind'),
        { type: 'separator' },
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
        item('goDashboard'),
        item('goBudget'),
        item('goHistory'),
        item('goSettings'),
        { type: 'separator' },
        item('prevMonth'),
        item('nextMonth'),
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
    {
      label: '&Help',
      submenu: [
        // Disabled label, not an action: the first thing anyone needs when
        // reporting a problem is the version they are actually running.
        { label: `Version ${app.getVersion()}`, enabled: false },
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => send('checkUpdates') },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({ role: 'appMenu', label: app.name });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
