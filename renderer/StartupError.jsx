/* ============================================================
   Startup failure.

   The store never came up, so there is no app behind this and no toast to
   show. Name the problem, say the data is still on disk, and offer the things
   that actually recover it.

   One failure is known exactly and gets its own copy: a database saved by a
   newer version of the app (main/db.ts refuses it before running anything on
   it). Guessing at a lock or a sync program there would send the user looking
   for a problem that isn't one, so it says "update" instead, names both
   versions, and carries the update banner, which is the fix.
   ============================================================ */
import React from 'react';
import { api, can } from './lib/api.js';
import { Icons, Tile } from './ui/index.js';
import { UpdateBanner } from './UpdateBanner.jsx';

function copyFor(error) {
  if (error && error.code === "db_too_new") {
    return {
      title: "This budget is from a newer version",
      body: "This budget was saved by a newer version of House Budget. Update the app to open it. Your budget file is still on this device, and nothing has been changed.",
      detail: `Budget file: version ${error.found}. This version of House Budget reads up to version ${error.supported}.`,
      offerUpdate: true,
    };
  }
  return {
    title: "House Budget couldn't open your data",
    body: "Your budget file is still on this device, and nothing has been changed or deleted. This usually means the app is already running in another window, or the file is being synced by another program.",
    detail: error && error.message,
    offerUpdate: false,
  };
}

export function StartupErrorScreen({ error, onRetry }) {
  const openFolder = async () => {
    if (!can("revealDataFolder")) return;
    try { await api.revealDataFolder(); } catch (e) { console.error(e); }
  };
  const copy = copyFor(error);
  return (
    <div className="startup-error">
      <div className="panel startup-error-card">
        <Tile icon={Icons.alert} size="lg" tone="breach" className="startup-error-icon" />
        <h3 className="startup-error-title">{copy.title}</h3>
        <p className="startup-error-body">{copy.body}</p>
        {/* A driver error string genuinely is code, so it takes the mono
            face. The version line is a version line, but it sits where the
            driver's string would and reads as the same kind of evidence. */}
        <p className="code startup-error-detail">{copy.detail}</p>
        {/* Renders nothing until the updater has found a release, and spaces
            itself from the buttons when it does. */}
        {copy.offerUpdate && <UpdateBanner />}
        <div className="startup-error-actions">
          <button className="btn btn-primary" onClick={onRetry}>Try again</button>
          <button className="btn" onClick={openFolder}><Icons.folder size={15} /> Open data folder</button>
        </div>
      </div>
    </div>
  );
}
