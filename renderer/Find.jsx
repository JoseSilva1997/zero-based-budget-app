/* ============================================================
   Find - editor-style Ctrl+F over the active tab.

   The search root is .main-inner, which holds exactly the screen you are
   looking at: one tab, and on Month Budget one month. That is the whole of
   the "only search what's active" rule - there is no per-tab logic below.

   Two kinds of match, one ordered list:
     - text nodes, highlighted as exact substrings through the CSS Custom
       Highlight API, so nothing in the DOM is rewritten and React never
       sees a tree it did not render;
     - input values (item names, group names, amounts), which are not text
       nodes at all, highlighted as whole fields.

   Inputs are never focused. TextInline and MoneyInput both commit on blur,
   so moving focus through fields during a search would write values.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icons } from './components.jsx';

const SEARCH_ROOT = ".main-inner";
const HL_MATCH = "find-match";
const HL_CURRENT = "find-current";
/* Inputs whose value is content worth finding. */
const INPUT_SEL = "input.tinput, input.minput";
/* Re-scan delay after the rendered content changes. */
const RESCAN_MS = 80;
/* Keystroke settle before a query is walked, so a typed word costs one scan. */
const TYPE_MS = 120;
/* Anything modal: the find bar floats above these, but the content it would
   highlight and scroll to is behind their veil. */
const DIALOG_SEL = '[role="dialog"]';
/* Enough matches for any real search; the walk and the count both stay bounded. */
const MAX_MATCHES = 999;

const highlightsSupported = () => typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight === "function";

function skipSubtree(el) {
  if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return true;
  // <option> text has no layout box, so a match there can be neither shown
  // nor scrolled to. The account chips render the same names as real text
  // beside their select, so nothing findable is lost by skipping these.
  if (el.tagName === "SELECT") return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  return el.hasAttribute("hidden");
}

/** Ordered match list over `root`, in document order. */
export function collectMatches(root, query) {
  const q = String(query || "").toLowerCase();
  if (!root || !q) return [];
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (skipSubtree(node)) return NodeFilter.FILTER_REJECT;
        return node.matches(INPUT_SEL) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return node.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (out.length >= MAX_MATCHES) break;
    if (node.nodeType === Node.ELEMENT_NODE) {
      // One match per field: the whole control lights up, so a second hit
      // inside the same field would be a step that changes nothing on screen.
      if (String(node.value || "").toLowerCase().includes(q)) out.push({ type: "input", el: node });
      continue;
    }
    const hay = node.data.toLowerCase();
    for (let i = hay.indexOf(q); i !== -1 && out.length < MAX_MATCHES; i = hay.indexOf(q, i + q.length)) {
      out.push({ type: "text", node, start: i, end: i + q.length });
    }
  }
  return out;
}

function rangeFor(m) {
  const r = document.createRange();
  r.setStart(m.node, m.start);
  r.setEnd(m.node, m.end);
  return r;
}

function clearFieldMarks(root) {
  if (!root) return;
  root.querySelectorAll(".find-hit, .find-hit-current").forEach((el) => el.classList.remove("find-hit", "find-hit-current"));
}

function paint(root, matches, current) {
  clearFieldMarks(root);
  const ok = highlightsSupported();
  const rest = ok ? new Highlight() : null;
  const cur = ok ? new Highlight() : null;
  matches.forEach((m, i) => {
    const isCurrent = i === current;
    if (m.type === "input") { m.el.classList.add(isCurrent ? "find-hit-current" : "find-hit"); return; }
    if (ok) (isCurrent ? cur : rest).add(rangeFor(m));
  });
  if (ok) {
    CSS.highlights.set(HL_MATCH, rest);
    CSS.highlights.set(HL_CURRENT, cur);
  }
}

function clearPaint(root) {
  clearFieldMarks(root);
  if (highlightsSupported()) {
    CSS.highlights.delete(HL_MATCH);
    CSS.highlights.delete(HL_CURRENT);
  }
}

function reveal(m) {
  if (!m) return;
  const el = m.type === "input" ? m.el : m.node.parentElement;
  if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
}

/* ---- the bar ------------------------------------------------------------ */
function FindBar({ onClose, focusToken }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [current, setCurrent] = useState(0);
  const inputRef = useRef(null);
  const queryRef = useRef("");
  useEffect(() => { queryRef.current = query; }, [query]);

  // Find and a dialog cannot both be the thing in front of you. Opening over
  // one would highlight and scroll content nobody can see behind the veil, so
  // the bar refuses to open there, and stands down if one arrives while it is
  // up. The check is made here rather than at the Ctrl+F binding because the
  // dialogs mount themselves; asking the document is what actually knows.
  const [blocked] = useState(() => !!document.querySelector(DIALOG_SEL));
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { if (blocked) closeRef.current(); }, [blocked]);
  useEffect(() => {
    if (blocked) return;
    // childList only, and one selector per batch: this fires on every commit
    // in the app, so it must stay close to free.
    const obs = new MutationObserver(() => {
      if (document.querySelector(DIALOG_SEL)) closeRef.current();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [blocked]);

  // Ctrl+F while already open re-selects, the way an editor does.
  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); }
  }, [focusToken]);

  /* One walk of the tree, shared by both the things that ask for it.
     `fresh` is a new query: start at the top and jump to the first hit.
     Otherwise the content moved under us and the user keeps their place. */
  const scan = useCallback((fresh) => {
    const q = queryRef.current;
    if (!q) { setMatches([]); setCurrent(0); return; }
    const next = collectMatches(document.querySelector(SEARCH_ROOT), q);
    setMatches(next);
    if (fresh) { setCurrent(0); if (next.length) reveal(next[0]); }
    else setCurrent((c) => (next.length ? Math.min(c, next.length - 1) : 0));
  }, []);

  // Typing is debounced: every keystroke re-walking the whole tab meant a
  // typed word cost one full walk per letter.
  useEffect(() => {
    if (!query) { setMatches([]); setCurrent(0); return; }
    const t = setTimeout(() => scan(true), TYPE_MS);
    return () => clearTimeout(t);
  }, [query, scan]);

  // The rendered content changes under us on tab switch, month switch and
  // every edit. Re-scan without moving the user's place in the results.
  // Only childList/characterData are observed: painting a field toggles a
  // class, and observing attributes would make that feed back into a re-scan.
  // With no query there is nothing to keep in step, and the whole walk is
  // skipped: an open find bar must not tax every commit in the month.
  useEffect(() => {
    const root = document.querySelector(SEARCH_ROOT);
    if (!root || blocked) return;
    let timer = null;
    const obs = new MutationObserver(() => {
      if (!queryRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => scan(false), RESCAN_MS);
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { clearTimeout(timer); obs.disconnect(); };
  }, [blocked, scan]);

  useEffect(() => { paint(document.querySelector(SEARCH_ROOT), matches, current); }, [matches, current]);
  useEffect(() => () => clearPaint(document.querySelector(SEARCH_ROOT)), []);

  const go = useCallback((delta) => {
    setCurrent((c) => {
      if (matches.length === 0) return 0;
      const next = (c + delta + matches.length) % matches.length;
      reveal(matches[next]);
      return next;
    });
  }, [matches]);

  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); go(-1); }
    // Modal and WalletDrawer both listen for Escape on window, which is the
    // last stop on the way up. Stopping the event here means one Escape
    // closes one thing: this bar, and not the dialog behind it as well.
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  const none = query.length > 0 && matches.length === 0;
  // The walk stops at MAX_MATCHES, so say "of 999+" rather than claiming a
  // total that was never counted.
  const capped = matches.length >= MAX_MATCHES;
  const count = `${current + 1} of ${matches.length}${capped ? "+" : ""}`;

  if (blocked) return null;

  return (
    <div className="find-bar" role="search">
      <Icons.search size={15} />
      <input ref={inputRef} className="find-input" value={query} autoFocus
        placeholder="Find in this tab…" aria-label="Find in this tab"
        onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      <span className={`find-count ${none ? "find-count-none" : ""}`} aria-live="polite">
        {query.length === 0 ? "" : none ? "No results" : count}
      </span>
      <button className="icon-btn" onClick={() => go(-1)} disabled={!matches.length} title="Previous match (Shift+Enter)" aria-label="Previous match"><Icons.up size={15} /></button>
      <button className="icon-btn" onClick={() => go(1)} disabled={!matches.length} title="Next match (Enter)" aria-label="Next match"><Icons.down size={15} /></button>
      <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close find"><Icons.x size={15} /></button>
    </div>
  );
}

export { FindBar };
