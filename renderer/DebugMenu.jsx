/* ============================================================
   Dev-only debug button.

   A small draggable button that floats over the app and opens a menu of
   development tools. It exists in `npm run dev` only. esbuild substitutes
   process.env.NODE_ENV (see scripts/build-renderer.mjs), so main.jsx's inline
   test folds to `false` in a production build and this whole module is
   tree-shaken out of the bundle - not merely hidden. The main-process half is
   gated separately, on !app.isPackaged, so a shipped build has no debug
   channels for a renderer to call even if one somehow got there.

   Note the .claude/skills/screenshot-app skill builds the renderer in
   production mode, so this button never appears in the screenshots that skill
   takes either - which is what keeps the two capture routes producing
   identical images.

   Adding another tool is one entry in ITEMS inside the component.
   ============================================================ */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from './store.jsx';

const IS_DEV = process.env.NODE_ENV === 'development';

const SIZE = 44;        // button edge, px
const EDGE = 16;        // closest the button may sit to a viewport edge
const DRAG_SLOP = 4;    // movement below this is a click, not a drag
const POS_KEY = 'hb.debug.pos';

/* ---- icons --------------------------------------------------------------
   Local to this file rather than added to components.jsx's Icons: that set is
   the app's own language and has no business carrying dev-only art. Same
   stroke weight and canvas as Ic() there, so they don't look foreign. */
function Glyph({ size = 18, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const BugGlyph = (p) => (
  <Glyph {...p}>
    <rect x="8" y="6" width="8" height="13" rx="4" />
    <path d="M9.5 6a2.5 2.5 0 0 1 5 0" />
    <path d="M8 11H4.5M16 11h3.5M8 15.5l-3 2M16 15.5l3 2M8.5 7.5l-2.5-2M15.5 7.5l2.5-2" />
  </Glyph>
);
const CameraGlyph = (p) => (
  <Glyph {...p}>
    <path d="M3 8.5a2 2 0 0 1 2-2h2l1.3-2h7.4L17 6.5h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Z" />
    <circle cx="12" cy="12.8" r="3.4" />
  </Glyph>
);

/* ---- position ----------------------------------------------------------- */

/** Keep a top-left inside the viewport, EDGE px clear of every side. */
function clampPos(p) {
  const maxX = Math.max(EDGE, window.innerWidth - SIZE - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
  return {
    x: Math.min(Math.max(p.x, EDGE), maxX),
    y: Math.min(Math.max(p.y, EDGE), maxY),
  };
}

/** Last placement, or the bottom-right corner on a first run. */
function loadPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return clampPos(raw);
  } catch { /* corrupt or unavailable storage just means the default */ }
  return clampPos({ x: window.innerWidth, y: window.innerHeight });
}

/** Two frames: one for a DOM change to land, one for layout and paint. */
const nextPaint = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/* ---- component ----------------------------------------------------------
   The IS_DEV guard is a wrapper rather than an early return inside the body,
   so the hooks below are never conditional. main.jsx makes the same test before
   rendering this at all; this is the belt to that pair of braces. */
export function DebugMenu() {
  return IS_DEV ? <DebugMenuPanel /> : null;
}

function DebugMenuPanel() {
  const { toast } = useStore();
  const [pos, setPos] = useState(loadPos);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const drag = useRef(null);          // { dx, dy, x0, y0, moved } while a pointer is down
  const skipClick = useRef(false);    // set when a drag happened, so its click does not toggle
  const posRef = useRef(pos);         // pointerup reads the final position without re-binding
  useEffect(() => { posRef.current = pos; }, [pos]);

  /* ---- drag ----
     A pointer drag and a click share one gesture here, so they are separated
     by distance: past DRAG_SLOP the button moves and the trailing click is
     swallowed; under it nothing moves and the click toggles the menu. Toggling
     on `click` rather than pointerup is what keeps Enter and Space working,
     since a keyboard activation fires click with no pointer sequence at all. */
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_SLOP) return;
      d.moved = true;
      setOpen(false);   // a menu anchored to a moving button is just noise
    }
    setPos(clampPos({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved) return;
    skipClick.current = true;
    try { localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch { /* non-fatal */ }
  };

  const onClick = () => {
    if (skipClick.current) { skipClick.current = false; return; }
    setOpen((o) => !o);
  };

  // A window that shrinks under the button would otherwise strand it offscreen
  // with no way to drag it back.
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Escape and outside-click close. The button is inside rootRef, so its own
  // pointerdown does not close here - the click that follows toggles instead.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* ---- tools ---- */
  const takeShot = useCallback(async () => {
    if (!window.api || typeof window.api.debugScreenshot !== 'function') {
      toast('Screenshots need the desktop bridge, which is not available here.', 'error');
      return;
    }
    setOpen(false);
    setBusy(true);
    // Hidden imperatively, not through state: this has to be in the DOM before
    // the very next paint, and a React commit is not guaranteed to be.
    const root = rootRef.current;
    if (root) root.style.visibility = 'hidden';
    try {
      await nextPaint();
      // .main is the app's scroll container (app.css); the document never
      // overflows, so measuring documentElement would always report zero.
      const el = document.querySelector('.main') || document.documentElement;
      const extraW = Math.max(0, el.scrollWidth - el.clientWidth);
      const extraH = Math.max(0, el.scrollHeight - el.clientHeight);
      const { path } = await window.api.debugScreenshot({ extraW, extraH });
      const name = path.split(/[\\/]/).pop();
      toast(`Screenshot saved as ${name}`, 'success', {
        label: 'Show in folder',
        onAct: () => { window.api.debugReveal(path).catch((err) => console.error(err)); },
      });
    } catch (err) {
      console.error('debug screenshot failed', err);
      toast(`Screenshot failed. ${err.message}`, 'error');
    } finally {
      if (root) root.style.visibility = '';
      setBusy(false);
    }
  }, [toast]);

  const ITEMS = [
    { id: 'shot', label: 'Full page screenshot', hint: 'Whole scroll height, button hidden', icon: CameraGlyph, run: takeShot },
  ];

  /* The menu opens back towards the middle of the window, so it stays on
     screen wherever the button has been parked. */
  const openLeft = pos.x + SIZE / 2 > window.innerWidth / 2;
  const openUp = pos.y + SIZE / 2 > window.innerHeight / 2;
  const menuStyle = {
    [openLeft ? 'right' : 'left']: 0,
    [openUp ? 'bottom' : 'top']: SIZE + 8,
  };

  return (
    <div ref={rootRef} className="debug-fab" style={{ left: pos.x, top: pos.y }}>
      {open && (
        <div className="debug-menu" role="menu" aria-label="Debug tools" style={menuStyle}>
          <div className="eyebrow debug-menu-head">Debug</div>
          {ITEMS.map(({ id, label, hint, icon: Ico, run }) => (
            <button key={id} className="debug-menu-item" role="menuitem" disabled={busy} onClick={run}>
              <Ico size={16} />
              <span>
                {label}
                {hint && <span className="debug-menu-hint">{hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        ref={btnRef}
        className={`debug-fab-btn ${open ? 'on' : ''}`}
        aria-label="Debug tools (drag to move)"
        title="Debug tools - click to open, drag to move"
        aria-expanded={open}
        aria-haspopup="menu"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
      >
        <BugGlyph size={20} />
      </button>
    </div>
  );
}
