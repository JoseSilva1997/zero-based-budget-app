/* ============================================================
   The Dashboard's cards: stats the household picks, laid out on a grid 4
   columns wide and up to 3 rows deep, each card covering as many cells as
   the household gives it.

   A card's size is its weight. Its figure is drawn at one of three rungs by
   how many cells it covers (lib/cardGrid.js sizeOf), so a household says
   which number leads by making that card bigger, not by the order it comes
   in.

   Reading: only the rows the cards reach take space. A card is its stat's
   title over its figure; the sentence explaining the figure is its tooltip.
   Each card's menu button
   (quiet until the card is hovered or holds focus) opens the list of stats;
   a stat that needs a choice (a group or category, a savings goal, a share
   of income) asks for it in the same menu as a second step.

   Editing (the Edit cards button on the screen's header): all three rows
   show, with every free cell drawn as a dashed box.
     - click a free cell, or drag across free cells, to add a card that size;
       its menu opens to choose the stat
     - drag a card to move it, its corner to resize it; dropped on another
       card, the two swap places
     - keyboard: a card takes focus; the arrows move it (onto a neighbour,
       they swap), Shift and the arrows resize it, Delete removes it
   A move, swap or resize that would leave the grid or cover another card is
   not made. Every change is saved as it happens.

   The arithmetic lives in lib/dashboardStats.js, the grid's rules in
   lib/cardGrid.js; this file only draws them and turns gestures into calls.
   ============================================================ */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnchoredMenu, Icons } from './ui/index.js';
import { cx } from './lib/index.js';
import { PERCENT_CHOICES, SECTIONS, STATS, choicesFor, computeStat } from './lib/dashboardStats.js';
import { GRID_COLS, GRID_ROWS, cardAt, fits, freeCells, moveCard, placeCard, rectBetween, resizeCard, sizeOf, swapCards } from './lib/cardGrid.js';

/* grid-column / grid-row for a rectangle. Runtime values, so inline. */
const placement = (r) => ({ gridColumn: `${r.x} / span ${r.w}`, gridRow: `${r.y} / span ${r.h}` });

/* The list of stats, then (for a stat that needs one) the choice. */
function CardMenu({ anchorRef, card, ctx, onPick, onClose }) {
  const [asking, setAsking] = useState(null); // the stat waiting for its choice
  const choose = (s, close) => {
    if (!s.needs) { onPick({ stat: s.id }); close(); return; }
    setAsking(s);
  };
  const done = (patch, close) => { onPick({ stat: asking.id, ...patch }); close(); };

  return (
    <AnchoredMenu anchorRef={anchorRef} className="dash-card-menu" onClose={onClose}
      label={asking ? asking.label : "Choose what this card shows"}>
      {(close) => (asking ? (
        <>
          <button type="button" className="move-menu-item dash-menu-back" onClick={() => setAsking(null)}>
            <span className="dash-menu-back-text"><Icons.left size={13} /> All stats</span>
          </button>
          <div className="eyebrow move-menu-label">{asking.label.replace(/\u2026$/, "")}</div>
          {asking.needs === "percent" && PERCENT_CHOICES.map((p, i) => (
            <button key={p} type="button" className="move-menu-item" autoFocus={i === 0}
              onClick={() => done({ percent: p }, close)}>
              <span>{p}% of income or more</span>
              {card.stat === asking.id && card.percent === p && <Icons.check size={14} />}
            </button>
          ))}
          {asking.needs === "goal" && <GoalChoices ctx={ctx} card={card} onPick={(goal) => done({ goal }, close)} />}
          {asking.needs === "of" && <SpendChoices ctx={ctx} card={card} stat={asking} onPick={(of) => done({ of }, close)} />}
        </>
      ) : SECTIONS.map((section, si) => (
        <div key={section}>
          <div className="eyebrow move-menu-label">{section}</div>
          {STATS.filter((s) => s.section === section).map((s, i) => (
            <button key={s.id} type="button" className="move-menu-item" autoFocus={si === 0 && i === 0}
              aria-pressed={card.stat === s.id} onClick={() => choose(s, close)}>
              <span>{s.label}</span>
              {card.stat === s.id && <Icons.check size={14} />}
            </button>
          ))}
        </div>
      )))}
    </AnchoredMenu>
  );
}

/* Spend groups, each followed by its categories: a group says more than one
   category often does, so both are offered. Savings groups are not
   spending, so they are not here. */
function SpendChoices({ ctx, card, stat, onPick }) {
  const groups = choicesFor(ctx, "of");
  if (!groups.length) return <div className="move-menu-note">No spending categories yet</div>;
  const on = (kind, id) => card.stat === stat.id && card.of && card.of.kind === kind && card.of.id === id;
  return groups.map((g, gi) => (
    <div key={g.id}>
      <button type="button" className="move-menu-item" autoFocus={gi === 0} onClick={() => onPick({ kind: "group", id: g.id })}>
        <span className="dash-menu-text"><span className="truncate">{g.name}</span><span className="dash-menu-hint">the whole group</span></span>
        {on("group", g.id) && <Icons.check size={14} />}
      </button>
      {g.categories.map((c) => (
        <button key={c.id} type="button" className="move-menu-item is-nested" onClick={() => onPick({ kind: "category", id: c.id })}>
          <span className="truncate">{c.name}</span>
          {on("category", c.id) && <Icons.check size={14} />}
        </button>
      ))}
    </div>
  ));
}

function GoalChoices({ ctx, card, onPick }) {
  const goals = choicesFor(ctx, "goal");
  if (!goals.length) return <div className="move-menu-note">Mark a group as savings to have goals here</div>;
  return goals.map((c, i) => (
    <button key={c.id} type="button" className="move-menu-item" autoFocus={i === 0} onClick={() => onPick(c.id)}>
      <span className="truncate">{c.name}</span>
      {card.stat === "goalTotal" && card.goal === c.id && <Icons.check size={14} />}
    </button>
  ));
}

const KEY_STEP = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function DashCard({ card, ctx, currency, editing, autoOpen, helpId, dragging, onPick, onKeyChange, onRemove, onStartDrag, onMenuClosed }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(!!autoOpen);
  const { title, figure, note } = computeStat(card, ctx, currency);
  const close = () => { setOpen(false); onMenuClosed(); };

  const onKeyDown = (e) => {
    if (!editing || e.target !== e.currentTarget) return;
    if (KEY_STEP[e.key]) {
      e.preventDefault();
      const [dx, dy] = KEY_STEP[e.key];
      onKeyChange(e.shiftKey ? "resize" : "move", dx, dy);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove();
    }
  };
  // A press on the card's own surface (not one of its buttons) starts a move;
  // on the corner handle, a resize.
  const onPointerDown = (e) => {
    if (!editing || e.button !== 0) return;
    const handle = e.target.closest("[data-dash-card-resize]");
    if (!handle && e.target.closest("button")) return;
    // No preventDefault: the press also has to focus the card for the
    // keyboard. .is-editing turns text selection off instead.
    onStartDrag(handle ? "resize" : "move", e);
  };

  return (
    <div data-dash-card className={cx("dash-card", `is-${sizeOf(card)}`, editing && "is-editing", dragging && "is-dragging", open && "is-open")}
      style={placement(card)} tabIndex={editing ? 0 : undefined} title={note}
      aria-label={editing ? `${title}: ${figure}` : undefined} aria-describedby={editing ? helpId : undefined}
      onKeyDown={onKeyDown} onPointerDown={onPointerDown}>
      {/* The title on top, the figure under it, nothing else. The sentence
          that explains the figure is the card's tooltip, and is read out
          after the figure. */}
      <div className="dash-card-head">
        <span className="dash-card-title">{title}</span>
        <div className="dash-card-tools">
        <button ref={btn} type="button" data-dash-card-menu className={cx("icon-btn compact subtle dash-card-btn", open && "is-open")}
          aria-label={`Change this card: ${title}`} aria-expanded={open} title="Change this card"
          onClick={() => (open ? close() : setOpen(true))}>
          <Icons.down size={14} />
        </button>
        {editing && (
          <button type="button" data-dash-card-remove className="icon-btn compact subtle dash-card-btn"
            aria-label={`Remove this card: ${title}`} title="Remove this card" onClick={onRemove}>
            <Icons.x size={14} />
          </button>
        )}
        </div>
      </div>
      <div className="dash-card-body">
        <span className={cx("num dash-card-figure", figure === "—" && "is-blank")}>{figure}</span>
        <span className="sr-only">{`, ${note}`}</span>
      </div>
      {editing && <span data-dash-card-resize className="dash-card-resize" aria-hidden="true" title="Drag to resize" />}
      {open && <CardMenu anchorRef={btn} card={card} ctx={ctx} onPick={onPick} onClose={close} />}
    </div>
  );
}

function DashboardCards({ cards, ctx, currency, editing, onChange }) {
  const grid = useRef(null);
  const helpId = useId();
  const [drag, setDrag] = useState(null); // { mode, i, from, rect, ok }
  const [menuFor, setMenuFor] = useState(null); // a card just added, whose menu opens

  /* The cell under a point, read from the grid's own resolved tracks so rows
     of different heights are measured as drawn. Clamped to the grid. */
  const cellAt = useCallback((px, py) => {
    const el = grid.current;
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // Each track owns its own width plus half the gap on either side.
    const find = (tracks, gap, offset) => {
      const sizes = tracks.split(" ").map(parseFloat).filter((n) => !Number.isNaN(n));
      let end = 0;
      for (let i = 0; i < sizes.length; i++) {
        end += sizes[i];
        if (offset < end + gap / 2) return i + 1;
        end += gap;
      }
      return Math.max(1, sizes.length);
    };
    return {
      x: Math.min(GRID_COLS, find(cs.gridTemplateColumns, parseFloat(cs.columnGap) || 0, px - box.left)),
      y: Math.min(GRID_ROWS, find(cs.gridTemplateRows, parseFloat(cs.rowGap) || 0, py - box.top)),
    };
  }, []);

  /* What dropping here would do: the cards it would leave, the rectangle the
     dragged card would take, and, for a swap, where the other card would go.
     A move with the pointer over another card is a swap; otherwise the card
     shifts by as many cells as the pointer has. `ok` is false when the drop
     would change nothing because it does not fit; dropping a card back where
     it started is fine, it just changes nothing. */
  const land = useCallback((d, at) => {
    if (d.mode === "draw") {
      const rect = rectBetween(d.from, at);
      return { rect, next: fits(cards, rect) ? [...cards, { stat: "savedAllTime", ...rect }] : cards };
    }
    const c = cards[d.i];
    if (d.mode === "move") {
      const other = cardAt(cards, at, d.i);
      if (other >= 0) {
        const next = swapCards(cards, d.i, other);
        const o = cards[other];
        return next !== cards
          ? { rect: next[d.i], swap: next[other], next }
          : { rect: { ...c, x: o.x, y: o.y }, next };
      }
      const rect = { x: c.x + at.x - d.from.x, y: c.y + at.y - d.from.y, w: c.w, h: c.h };
      return { rect, next: placeCard(cards, d.i, rect), stays: rect.x === c.x && rect.y === c.y };
    }
    const rect = { x: c.x, y: c.y, w: Math.max(1, at.x - c.x + 1), h: Math.max(1, at.y - c.y + 1) };
    return { rect, next: placeCard(cards, d.i, rect), stays: rect.w === c.w && rect.h === c.h };
  }, [cards]);
  const dragAt = useCallback((d, at) => {
    const r = land(d, at);
    return { ...d, ...r, ok: r.next !== cards || !!r.stays };
  }, [land, cards]);

  const start = (mode, i, from) => setDrag(dragAt({ mode, i, from }, from));

  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (e) => {
      const at = cellAt(e.clientX, e.clientY);
      setDrag((d) => d && dragAt(d, at));
    };
    const onUp = () => {
      setDrag(null);
      if (drag.next === cards) return;
      if (drag.mode === "draw") setMenuFor(cards.length);
      onChange(drag.next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [drag, cards, cellAt, dragAt, onChange]);

  if (!cards.length && !editing) return null;

  const update = (i) => (patch) => onChange(cards.map((c, j) => (j === i ? { stat: patch.stat, ...patch, x: c.x, y: c.y, w: c.w, h: c.h } : c)));
  const remove = (i) => () => onChange(cards.filter((_, j) => j !== i));
  const keyChange = (i) => (mode, dx, dy) => {
    const next = mode === "resize" ? resizeCard(cards, i, dx, dy) : moveCard(cards, i, dx, dy);
    if (next !== cards) onChange(next);
  };
  const add = (cell) => { setMenuFor(cards.length); onChange([...cards, { stat: "savedAllTime", ...cell }]); };

  return (
    <div className={cx("dash-cards-wrap", editing && "is-editing")}>
      <div ref={grid} className={cx("dash-cards", editing && "is-editing", drag && "is-dragging")}>
        {editing && freeCells(cards).map((cell) => (
          <button key={`${cell.x}-${cell.y}`} type="button" data-dash-cell className="dash-cell" style={placement(cell)}
            aria-label={`Add a card at column ${cell.x}, row ${cell.y}`}
            onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); start("draw", -1, { x: cell.x, y: cell.y }); } }}
            // A pointer adds on release (it may be drawing a larger card);
            // the keyboard's click has no pointer behind it (detail 0).
            onClick={(e) => { if (e.detail === 0) add(cell); }}>
            <Icons.plus size={16} />
          </button>
        ))}
        {cards.map((card, i) => (
          <DashCard key={i} card={card} ctx={ctx} currency={currency} editing={editing} helpId={helpId}
            autoOpen={menuFor === i} dragging={drag && drag.mode !== "draw" && drag.i === i}
            onPick={update(i)} onKeyChange={keyChange(i)} onRemove={remove(i)} onMenuClosed={() => setMenuFor(null)}
            onStartDrag={(mode, e) => start(mode, i, cellAt(e.clientX, e.clientY))} />
        ))}
        {drag && <div aria-hidden="true" className={cx("dash-drop", !drag.ok && "is-blocked")} style={placement(drag.rect)} />}
        {/* A swap also shows where the other card would go. */}
        {drag && drag.swap && <div aria-hidden="true" className="dash-drop is-swap" style={placement(drag.swap)} />}
      </div>
      {editing && (
        <p id={helpId} className="dash-cards-help">
          Click an empty cell, or drag across several, to add a card. Drag a card to move it, onto another card to swap the
          two, or by its corner to resize it. With the keyboard, the arrows move a card, Shift and the arrows resize it, and
          Delete removes it.
        </p>
      )}
    </div>
  );
}

export { DashboardCards };
