#!/usr/bin/env node
/* ============================================================
   Take real screenshots of the House Budget Electron app, for visually
   verifying UI/CSS changes. See SKILL.md in this directory for full usage
   and examples.

   Safety: this app's normal dev launch (`electron .` / `npm start`) reads
   and writes the SAME database a real user's installed app uses - there is
   no separate dev/prod data directory. So by default this script launches
   into an isolated sandbox userData directory (via Electron's built-in
   --user-data-dir flag) that is pre-seeded with small, realistic fixture
   data. It NEVER touches real app data unless BOTH --real and
   --confirm-real-data are passed, deliberately, together.
   ============================================================ */
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { captureFullPage } from './full-page-capture.mjs';

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SKILL_DIR, '..', '..', '..');
const SANDBOX_DIR = path.join(SKILL_DIR, '.sandbox-userdata');
// npm/npx are .cmd shims on Windows and only resolve through a shell; other
// platforms run the real executable directly, where shell:true just adds an
// unescaped-argument risk for no benefit.
const NEEDS_SHELL = process.platform === 'win32';

// The app's four sidebar tabs, in nav order - `--all-screens` walks these.
const ALL_SCREENS = [
  ['Dashboard', 'dashboard.png'],
  ['Month Budget', 'month-budget.png'],
  ['History', 'history.png'],
  ['Settings', 'settings.png'],
];

function printHelp() {
  console.log(`
Usage: node screenshot.mjs [flags] [steps...]

Steps run in the order given, against one Electron launch:
  --nav <text>        click a sidebar nav item or any button/link by visible
                       text or aria-label (alias of --click)
  --click <text>       same as --nav; named separately for readability
  --shot <path>        take a screenshot, saved to <path> (relative to cwd)
  --wait <ms>           pause before the next step
  --type <text>         type text at the current keyboard focus
  --press <key>         press a single key (e.g. Enter, Escape, Tab)
  --eval <js-expr>      run a JS expression in the page, print the JSON result
  --all-screens <dir>   shorthand step: visit all 4 tabs (Dashboard, Month
                         Budget, History, Settings) and shoot each one to
                         <dir>/<tab-name>.png - same as writing out four
                         --nav/--wait/--shot triples yourself

Flags:
  --no-build            skip the "npm run build && build:renderer" step
                         (only safe if you know the last build is current)
  --reseed              wipe and re-seed the sandbox fixture DB first
  --real                launch against the REAL app data instead of the
                         sandbox - requires --confirm-real-data too
  --confirm-real-data    the second half of the --real safety interlock
  --no-fullpage          screenshot only the visible viewport, not the full
                         scrollable page (default is full page)
  --help, -h             print this message

Example - screenshot the Settings > Appearance panel:
  node .claude/skills/screenshot-app/screenshot.mjs \\
    --nav Settings --wait 400 --shot out/settings.png

Example - switch theme and compare (Obsidian is the only theme today; use
whatever label the card shows once there are more):
  node .claude/skills/screenshot-app/screenshot.mjs \\
    --nav Settings --wait 400 \\
    --click Obsidian --wait 300 \\
    --shot out/settings-obsidian.png \\
    --nav "Month Budget" --wait 400 --shot out/month-obsidian.png

Example - one screenshot of each of the 4 screens:
  node .claude/skills/screenshot-app/screenshot.mjs --all-screens out
`);
}

function parseArgs(argv) {
  const steps = [];
  const opts = { build: true, reseed: false, real: false, confirmReal: false, fullpage: true, help: false, sandbox: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} requires a value`);
      return argv[++i];
    };
    switch (a) {
      case '--nav': case '--click': steps.push({ kind: 'click', text: next() }); break;
      case '--shot': steps.push({ kind: 'shot', out: next() }); break;
      case '--wait': steps.push({ kind: 'wait', ms: Number(next()) }); break;
      case '--type': steps.push({ kind: 'type', text: next() }); break;
      case '--press': steps.push({ kind: 'press', key: next() }); break;
      case '--eval': steps.push({ kind: 'eval', js: next() }); break;
      case '--all-screens': steps.push({ kind: 'all-screens', dir: next() }); break;
      case '--no-build': opts.build = false; break;
      case '--reseed': opts.reseed = true; break;
      case '--sandbox': opts.sandbox = next(); break;
      case '--real': opts.real = true; break;
      case '--confirm-real-data': opts.confirmReal = true; break;
      case '--no-fullpage': opts.fullpage = false; break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`unknown flag: ${a} (see --help)`);
    }
  }
  return { steps, opts };
}

/* Matches the app's own UI patterns: nav items, radio-swatch buttons (whose
   visible label may differ from their fuller aria-label), and plain buttons.
   Exact match wins over a substring match so "Navy" doesn't also hit some
   unrelated element whose label merely contains "Navy". */
async function clickText(page, text) {
  return page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a, [role="button"], [role="radio"]')];
    const el = els.find((e) => e.getAttribute('aria-label') === t)
      ?? els.find((e) => e.textContent?.trim() === t)
      ?? els.find((e) => e.getAttribute('aria-label')?.includes(t))
      ?? els.find((e) => e.textContent?.includes(t));
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'OK';
  }, text);
}

async function takeShot(app, page, outPath, opts) {
  const out = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (opts.fullpage) {
    // Playwright's own fullPage option grows the viewport to the
    // *document's* scroll size, but this app scrolls inside .main, not
    // the document - see full-page-capture.mjs for why that makes
    // fullPage:true a silent no-op here, and what this does instead.
    const png = await captureFullPage(app, page);
    fs.writeFileSync(out, png);
  } else {
    await page.screenshot({ path: out, fullPage: false });
  }
  console.log('screenshot ->', out);
}

async function runSteps(app, page, steps, opts) {
  for (const step of steps) {
    if (step.kind === 'click') {
      const result = await clickText(page, step.text);
      console.log('click', JSON.stringify(step.text), '->', result);
      if (result === 'NOT_FOUND') console.warn(`  (nothing on screen matched ${JSON.stringify(step.text)} - check spelling/case, or the screen it's on hasn't loaded yet)`);
    } else if (step.kind === 'shot') {
      await takeShot(app, page, step.out, opts);
    } else if (step.kind === 'all-screens') {
      for (const [tab, file] of ALL_SCREENS) {
        const result = await clickText(page, tab);
        console.log('click', JSON.stringify(tab), '->', result);
        if (result === 'NOT_FOUND') { console.warn(`  (skipping ${tab} - nav item not found)`); continue; }
        await page.waitForTimeout(400);
        await takeShot(app, page, path.join(step.dir, file), opts);
      }
    } else if (step.kind === 'wait') {
      await page.waitForTimeout(step.ms);
    } else if (step.kind === 'type') {
      await page.keyboard.type(step.text, { delay: 20 });
    } else if (step.kind === 'press') {
      await page.keyboard.press(step.key);
    } else if (step.kind === 'eval') {
      const result = await page.evaluate(step.js);
      console.log('eval ->', JSON.stringify(result));
    }
  }
}

function electronBinary() {
  if (process.platform === 'darwin') return path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  if (process.platform === 'win32') return path.join(APP_DIR, 'node_modules/electron/dist/electron.exe');
  return path.join(APP_DIR, 'node_modules/electron/dist/electron');
}

async function main() {
  const { steps, opts } = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }

  if (opts.real && !opts.confirmReal) {
    throw new Error('--real requires --confirm-real-data too. This points the app at the ACTUAL budget data, not the sandbox - both flags must be passed on purpose. Drop --real to stay in the safe sandbox (recommended for UI verification).');
  }
  if (opts.confirmReal && !opts.real) {
    throw new Error('--confirm-real-data without --real does nothing - did you mean to pass --real too?');
  }

  if (opts.build) {
    console.log('[build] npm run build ...');
    execFileSync('npm', ['run', 'build'], { cwd: APP_DIR, stdio: 'inherit', shell: NEEDS_SHELL });
    console.log('[build] npm run build:renderer ...');
    execFileSync('npm', ['run', 'build:renderer'], { cwd: APP_DIR, stdio: 'inherit', shell: NEEDS_SHELL });
  }

  let userDataDir = null;
  if (!opts.real) {
    /* --sandbox names a private fixture DB. The default is one shared
       directory, which is right for a single session and wrong the moment two
       of them run at once: concurrent runs race on the same SQLite file, and a
       --reseed under a sibling's feet fails outright ("table
       household_members already exists") or, worse, silently changes the data
       a sibling is mid-way through screenshotting. A run that needs to CHANGE
       the fixture - adding a second month to exercise a comparison view - has
       no other safe way to do it while anything else is running. */
    userDataDir = opts.sandbox ? path.resolve(opts.sandbox) : SANDBOX_DIR;
    fs.mkdirSync(userDataDir, { recursive: true });
    const dataDir = path.join(userDataDir, 'data');
    const dbFile = path.join(dataDir, 'budget.sqlite');
    if (opts.reseed && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
    if (!fs.existsSync(dbFile)) {
      console.log('[seed] sandbox has no fixture DB yet, seeding...');
      execFileSync('npx', ['electron', path.join(SKILL_DIR, 'seed-fixture.cjs'), userDataDir], { cwd: APP_DIR, stdio: 'inherit', shell: NEEDS_SHELL });
    }
  } else {
    console.warn('!!! Launching against REAL app data. Any click can change real settings/data. !!!');
  }

  const launchArgs = userDataDir ? [`--user-data-dir=${userDataDir}`, APP_DIR] : [APP_DIR];
  const app = await electron.launch({ executablePath: electronBinary(), args: launchArgs, timeout: 30000 });

  // Electron has no clean "loaded" signal for this app; ready-to-show plus a
  // beat is the same margin the app's own window uses before it paints.
  await new Promise((r) => setTimeout(r, 3000));
  const page = app.windows().find((w) => !w.url().startsWith('devtools://')) ?? await app.firstWindow();
  await page.waitForTimeout(1000);
  console.log('launched:', page.url());

  try {
    await runSteps(app, page, steps, opts);
  } finally {
    await app.close();
  }
  console.log('done.');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
