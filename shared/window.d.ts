/* ============================================================
   Global augmentation: the typed 'window.api' surface exposed by
   'preload/index.ts'. The single source of truth is the preload's own
   'HouseBudgetApi' (the type of its 'api' object); we bind it to 'window.api'
   here. The preload unwraps the "{ data } | { error }" envelope, so these
   methods resolve to the inner shapes directly (and throw on error).
   ============================================================ */

import type { HouseBudgetApi } from '../preload/index';

declare global {
  interface Window {
    api: HouseBudgetApi;
  }
}

export {};
