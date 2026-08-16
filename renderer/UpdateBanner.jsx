/* ============================================================
   Auto-update UI.

   UpdateBanner is the only unprompted update UI the app shows. It lives at
   the foot of the sidebar, out of the way of the work. It stays silent while
   checking, when nothing is available, and on failure: someone who never
   asked about updates should not be told that checking for one failed. Three
   states earn a mention - a version offered (nothing is fetched until the
   user clicks Download), a download in progress, and one ready to install.

   UpdateSettings is the opposite contract. A user who clicked "check" is owed
   an answer, including the errors the banner hides.

   Both pull the current status on mount, because the startup check can settle
   before React is listening, then follow the pushed events.
   ============================================================ */
import React, { useState, useEffect, useCallback } from 'react';
import { Icons } from './ui/index.js';
import { cx } from './lib/index.js';

/** What went wrong with the last click, said in the banner that offered it. */
function BannerFailure({ text }) {
  return (
    <div className="update-banner-line is-failure">
      <Icons.alert size={15} />
      <span>{text}</span>
    </div>
  );
}

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
  const [busy, setBusy] = useState(false);
  // A click that does nothing is the worst of the failure modes: the banner
  // sits in the same state and the user is left to guess. The updater pushes
  // no status for a rejected call, so the banner has to hold the reason
  // itself. Any status that does arrive supersedes it.
  const [failure, setFailure] = useState(null);
  useEffect(() => { setFailure(null); }, [status]);

  // The status push flips the banner to its next state, so busy only has to
  // cover the gap between the click and that arriving.
  const download = async () => {
    setBusy(true);
    try { await window.api.updateDownload(); }
    catch (e) { console.error(e); setFailure(`The download couldn't be started. ${e.message || e}`); }
    finally { setBusy(false); }
  };

  const install = async () => {
    setBusy(true);
    try { await window.api.updateInstall(); }
    catch (e) { console.error(e); setFailure(`The restart couldn't be started. ${e.message || e}`); setBusy(false); }
  };

  const shown = status.state === 'available' || status.state === 'downloading' || status.state === 'downloaded';
  if (!shown) return null;
  // Dismissal is per version, so a later release is not silenced by a click
  // the user made about an earlier one.
  if (dismissedVersion === status.version) return null;

  return (
    <div className="update-banner" role="status" aria-live="polite">
      {status.state === 'downloading' ? (
        <>
          <div className="update-banner-line">Downloading version {status.version}…</div>
          <div className="update-banner-track">
            {/* Handed to CSS as a scale factor, not a width: the bar is out of
                flow and transitions transform only, so a progress push cannot
                re-lay out the sidebar it sits in. */}
            <div className="update-banner-bar" style={{ "--pct": (status.percent || 0) / 100 }} />
          </div>
        </>
      ) : status.state === 'available' ? (
        <>
          <div className="update-banner-line">
            <Icons.download size={15} />
            <span><strong>Version {status.version}</strong> is ready to download.</span>
          </div>
          {failure && <BannerFailure text={failure} />}
          <div className="update-banner-actions">
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={download}>
              {busy ? 'Starting…' : failure ? 'Try again' : 'Download'}
            </button>
            <button className="btn btn-sm" onClick={() => setDismissedVersion(status.version)}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="update-banner-line">
            <Icons.check size={15} />
            <span><strong>Version {status.version}</strong> is ready to install.</span>
          </div>
          {failure && <BannerFailure text={failure} />}
          <div className="update-banner-actions">
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={install}>
              {busy ? 'Restarting…' : failure ? 'Try again' : 'Restart now'}
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
  const [downloading, setDownloading] = useState(false);
  // A call that never reaches the updater pushes no status, so the same
  // promise here has to carry its own refusal to the person who asked.
  const [failure, setFailure] = useState(null);
  useEffect(() => { setFailure(null); }, [status]);

  const check = useCallback(async () => {
    setChecking(true);
    try { await window.api.updateCheck(); }
    catch (e) { console.error(e); setFailure(`Couldn't check for updates. ${e.message || e}`); }
    finally { setChecking(false); }
  }, []);

  const download = useCallback(async () => {
    setDownloading(true);
    try { await window.api.updateDownload(); }
    catch (e) { console.error(e); setFailure(`The download couldn't be started. ${e.message || e}`); }
    finally { setDownloading(false); }
  }, []);

  // "Later" only defers the restart: a downloaded update installs on quit
  // regardless, so say so rather than letting the banner's dismissal imply
  // the update was skipped.
  const line = {
    idle: 'Check for updates.',
    checking: 'Checking…',
    none: 'You are running the latest version.',
    available: `Version ${status.version} is ready to download.`,
    downloading: `Downloading version ${status.version} (${status.percent}%)…`,
    downloaded: `Version ${status.version} will install when you close the app.`,
    error: `Couldn't check for updates: ${status.message}`,
  }[status.state];

  return (
    <div className="update-setting-row">
      <div className={cx('update-setting-line', (failure || status.state === 'error') && 'is-failure')}>
        {failure || line}
      </div>
      {status.state === 'available' ? (
        <button className="btn btn-sm btn-primary" disabled={downloading} onClick={download}>
          {downloading ? 'Starting…' : failure ? 'Try again' : 'Download'}
        </button>
      ) : (
        <button className="btn btn-sm" disabled={checking || status.state === 'checking'} onClick={check}>
          {failure ? 'Try again' : 'Check now'}
        </button>
      )}
    </div>
  );
}