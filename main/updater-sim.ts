/* ============================================================
   Update simulation, for looking at the update UI without a release.

   Real updates need a published GitHub release that is newer than the running
   build, which makes the banner nearly impossible to eyeball while working on
   it. This module fakes the feed instead: the same statuses, the same
   sequence, the same buttons, but no network and nothing installed.

   Turn it on with any of:
     npm run dev:update                      the "available" scenario
     npm run dev:update:downloaded           jump straight to a pending install
     npm run dev -- --update-sim=error       (works in PowerShell too, see below)
     HB_UPDATE_SIM=error npm start           (env var works everywhere)

   Scenarios: available (default) | downloaded | none | error

   Refused in a packaged build: a real install must never be faked in front of
   a real user.
   ============================================================ */
import { app } from 'electron';
import type { UpdateStatus } from '../shared/types';

export type SimScenario = 'available' | 'downloaded' | 'none' | 'error';

const SCENARIOS: SimScenario[] = ['available', 'downloaded', 'none', 'error'];

/** A simulated updater, standing in for the electron-updater calls. */
export interface UpdateSim {
  scenario: SimScenario;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): void;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `--update-sim` or `--update-sim=<scenario>` from the command line. */
function flagValue(): string | undefined {
  const arg = process.argv.find((a) => a === '--update-sim' || a.startsWith('--update-sim='));
  if (arg) return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : 'available';

  // PowerShell drops the `--` separator in `npm run dev -- --update-sim=x`, so
  // npm treats the flag as one of its own configs and never forwards it. It
  // does re-export it into the environment, which is what this picks up: the
  // command works as typed instead of silently running against the real feed.
  return process.env.npm_config_update_sim;
}

/**
 * The scenario asked for, or null when the app should talk to the real feed.
 * An unrecognised name falls back to 'available' rather than silently doing
 * nothing, since the only reason to pass the flag is to see the UI.
 */
export function requestedScenario(): SimScenario | null {
  const raw = (process.env.HB_UPDATE_SIM ?? flagValue() ?? '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false') return null;

  if (app.isPackaged) {
    console.warn('[updater] update simulation ignored: this is a packaged build');
    return null;
  }

  if (raw === '1' || raw === 'true') return 'available';
  if ((SCENARIOS as string[]).includes(raw)) return raw as SimScenario;

  console.warn(`[updater] unknown scenario "${raw}", using "available". Try: ${SCENARIOS.join(', ')}`);
  return 'available';
}

/** The version being offered: the running one with its patch number bumped. */
function nextVersion(): string {
  const [major, minor, patch] = app.getVersion().split('.');
  return `${major ?? 1}.${minor ?? 0}.${Number(patch ?? 0) + 1}`;
}

/**
 * Build the fake updater. `broadcast` is the same one the real path uses, so
 * the renderer cannot tell the difference: it caches the status and pushes it
 * to every window.
 */
export function createUpdateSim(scenario: SimScenario, broadcast: (status: UpdateStatus) => void): UpdateSim {
  const version = nextVersion();

  // Logged so the terminal says exactly when the banner should be on screen.
  // "pushed available" with no banner in the window is a renderer problem;
  // no line at all means the check never ran.
  const push = (status: UpdateStatus): void => {
    console.log(`[updater] SIMULATION pushed "${status.state}"`);
    broadcast(status);
  };

  return {
    scenario,

    async check(): Promise<void> {
      push({ state: 'checking' });
      await delay(700); // long enough to see "Checking…" in settings
      switch (scenario) {
        case 'none':
          push({ state: 'none' });
          break;
        case 'error':
          push({ state: 'error', message: 'simulated failure: net::ERR_INTERNET_DISCONNECTED' });
          break;
        case 'downloaded':
          push({ state: 'downloaded', version });
          break;
        default:
          push({ state: 'available', version });
      }
    },

    /** Ticks to 100% over roughly three seconds, then hands over an install. */
    async download(): Promise<void> {
      for (let percent = 10; percent <= 100; percent += 10) {
        await delay(300);
        broadcast({ state: 'downloading', version, percent });
      }
      await delay(400);
      push({ state: 'downloaded', version });
    },

    install(): void {
      console.log(`[updater] SIMULATION: would quit and install ${version} now. The app stays open.`);
    },
  };
}
