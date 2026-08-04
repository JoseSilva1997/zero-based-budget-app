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
    if (node.nodeType === Node.ELEMENT_NODE) {
      // One match per field: the whole control lights up, so a second hit
      // inside the same field would be a step that changes nothing on screen.
      if (String(node.value || "").toLowerCase().includes(q)) out.push({ type: "input", el: node });
      continue;
    }
    const hay = node.data.toLowerCase();
    for (let i = hay.indexOf(q); i !== -1; i = hay.indexOf(q, i + q.length)) {
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

  // Ctrl+F while already open re-selects, the way an editor does.
  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); }
  }, [focusToken]);

  // A new query searches from the top and jumps to the first hit.
  useEffect(() => {
    const next = collectMatches(document.querySelector(SEARCH_ROOT), query);
    setMatches(next);
    setCurrent(0);
    if (next.length) reveal(next[0]);
  }, [query]);

  // The rendered content changes under us on tab switch, month switch and
  // every edit. Re-scan without moving the user's place in the results.
  // Only childList/characterData are observed: painting a field toggles a
  // class, and observing attributes would make that feed back into a re-scan.
  useEffect(() => {
    const root = document.querySelector(SEARCH_ROOT);
    if (!root) return;
    let timer = null;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = collectMatches(root, queryRef.current);
        setMatches(next);
        setCurrent((c) => (next.length ? Math.min(c, next.length - 1) : 0));
      }, RESCAN_MS);
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { clearTimeout(timer); obs.disconnect(); };
  }, []);

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
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  const none = query.length > 0 && matches.length === 0;

  return (
    <div className="find-bar" role="search">
      <Icons.search size={15} style={{ color: "var(--faint)", flex: "none" }} />
      <input ref={inputRef} className="find-input" value={query} autoFocus
        placeholder="Find in this tab…" aria-label="Find in this tab"
        onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      <span className={`find-count ${none ? "find-count-none" : ""}`} aria-live="polite">
        {query.length === 0 ? "" : none ? "No results" : `${current + 1} of ${matches.length}`}
      </span>
      <button className="icon-btn" onClick={() => go(-1)} disabled={!matches.length} title="Previous match (Shift+Enter)" aria-label="Previous match"><Icons.up size={15} /></button>
      <button className="icon-btn" onClick={() => go(1)} disabled={!matches.length} title="Next match (Enter)" aria-label="Next match"><Icons.down size={15} /></button>
      <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close find"><Icons.x size={15} /></button>
    </div>
  );
}

export { FindBar };
