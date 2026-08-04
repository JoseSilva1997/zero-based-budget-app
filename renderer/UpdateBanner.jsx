/* ============================================================
   Auto-update UI.

   UpdateBanner is the only unprompted update UI the app shows. It stays
   silent while checking, when nothing is available, and on failure: someone
   who never asked about updates should not be told that checking for one
   failed. Only two states earn an interruption - a download in progress
   (thin, ignorable) and a version ready to install (actionable).

   UpdateSettings is the opposite contract. A user who clicked "check" is owed
   an answer, including the errors the banner hides.

   Both pull the current status on mount, because the startup check can settle
   before React is listening, then follow the pushed events.
   ============================================================ */
import React, { useState, useEffect, useCallback } from 'react';
import { Icons } from './components.jsx';

/** Subscribe to updater status, seeded with whatever it is right now. */
function useUpdateStatus() {
  const [status, setStatus] = useState({ state: 'idle' });

  useEffect(() => {
    if (!window.api || typeof window.api.onUpdateStatus !== 'function') return;
    let alive = true;
    window.api.updateStatus().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    const off = window.api.onUpdateStatus((s) => setStatus(s));
    return () => { alive = false; off(); };
  }, []);

  return status;
}

export function UpdateBanner() {
  const status = useUpdateStatus();
  const [dismissedVersion, setDismissedVersion] = useState(null);
  const [installing, setInstalling] = useState(false);

  const install = async () => {
    setInstalling(true);
    try { await window.api.updateInstall(); } catch (e) { console.error(e); setInstalling(false); }
  };

  if (status.state !== 'downloading' && status.state !== 'downloaded') return null;
  // Dismissal is per version, so a later release is not silenced by a click
  // the user made about an earlier one.
  if (dismissedVersion === status.version) return null;

  return (
    <div className="card" role="status" aria-live="polite"
      style={{ position: 'fixed', right: 24, bottom: 26, zIndex: 70, width: 320,
               padding: '13px 15px', animation: 'pop .2s ease' }}>
      {status.state === 'downloading' ? (
        <>
          <div style={{ fontSize: 13.5, marginBottom: 9 }}>
            Downloading version {status.version}…
          </div>
          <div style={{ height: 4, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${status.percent}%`, background: 'var(--accent)',
                          borderRadius: 999, transition: 'width .3s ease' }} />
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 11 }}>
            <Icons.check size={16} style={{ color: 'var(--pos)', flex: 'none', marginTop: 2 }} />
            <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
              <strong>Version {status.version}</strong> is ready to install.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" disabled={installing} onClick={install}>
              {installing ? 'Restarting…' : 'Restart now'}
            </button>
            <button className="btn btn-sm" onClick={() => setDismissedVersion(status.version)}>
              Later
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function UpdateSettings() {
  const status = useUpdateStatus();
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try { await window.api.updateCheck(); } catch (e) { console.error(e); }
    finally { setChecking(false); }
  }, []);

  // "Later" only defers the restart: a downloaded update installs on quit
  // regardless, so say so rather than letting the banner's dismissal imply
  // the update was skipped.
  const line = {
    idle: 'Updates are checked automatically when the app starts.',
    checking: 'Checking…',
    none: 'You are running the latest version.',
    available: `Version ${status.version} found, downloading…`,
    downloading: `Downloading version ${status.version} (${status.percent}%)…`,
    downloaded: `Version ${status.version} will install when you close the app.`,
    error: `Couldn't check for updates: ${status.message}`,
  }[status.state];

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 16, padding: '14px 18px' }}>
      <div style={{ fontSize: 13.5, color: status.state === 'error' ? 'var(--neg-ink)' : 'var(--ink)' }}>
        {line}
      </div>
      <button className="btn btn-sm" disabled={checking || status.state === 'checking'} onClick={check}>
        Check now
      </button>
    </div>
  );
}