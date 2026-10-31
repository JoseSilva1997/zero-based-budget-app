/* ============================================================
   The Dashboard's card grid: 4 columns, up to 3 rows.

   A card covers a rectangle of cells, { x, y, w, h }: the column and row of
   its top-left cell (from 1), and how many columns and rows it spans. Cards
   never overlap and never leave the grid; a card moved onto another swaps
   places with it. Every function here is pure and
   returns the cards it was given, untouched, when a change would break
   either rule, so a caller can tell "nothing happened" by identity.

   The same rules are checked on the way into the database
   (database/repositories/dashboardCards.ts); these are the renderer's copy,
   used while the household drags and resizes.
   ============================================================ */
export const GRID_COLS = 4;
export const GRID_ROWS = 3;

const whole = (v) => Number.isInteger(v) && v >= 1;

export const inGrid = (r) =>
  whole(r.x) && whole(r.y) && whole(r.w) && whole(r.h)
  && r.x + r.w - 1 <= GRID_COLS && r.y + r.h - 1 <= GRID_ROWS;

export const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/* Whether `rect` is inside the grid and clear of every card but the one at
   index `skip` (the card being moved or resized). */
export function fits(cards, rect, skip = -1) {
  return inGrid(rect) && cards.every((c, i) => i === skip || !overlaps(c, rect));
}

/* The card at `i` put at `rect`, or the cards unchanged if it does not fit. */
export function placeCard(cards, i, rect) {
  const c = cards[i];
  if (!c || !fits(cards, rect, i)) return cards;
  if (c.x === rect.x && c.y === rect.y && c.w === rect.w && c.h === rect.h) return cards;
  return cards.map((card, j) => (j === i ? { ...card, x: rect.x, y: rect.y, w: rect.w, h: rect.h } : card));
}

/* Cards `i` and `j` trade places: each takes the other's top-left cell and
   keeps its own size. Two cards the same size swap exactly; for different
   sizes the swap is made only if both still fit, inside the grid and clear
   of each other and of every other card. */
export function swapCards(cards, i, j) {
  const a = cards[i], b = cards[j];
  if (!a || !b || i === j) return cards;
  const na = { ...a, x: b.x, y: b.y };
  const nb = { ...b, x: a.x, y: a.y };
  const others = cards.filter((_, k) => k !== i && k !== j);
  if (overlaps(na, nb) || !fits(others, na) || !fits(others, nb)) return cards;
  return cards.map((c, k) => (k === i ? na : k === j ? nb : c));
}

/* The index of the card covering `cell`, leaving out the one at `skip`, or
   -1 when the cell is free. */
export const cardAt = (cards, cell, skip = -1) =>
  cards.findIndex((c, k) => k !== skip && overlaps(c, { x: cell.x, y: cell.y, w: 1, h: 1 }));

/* Card `i` shifted by a step. Onto free cells it moves; onto exactly one
   other card, the two swap places; anything else changes nothing. */
export function moveCard(cards, i, dx, dy) {
  const c = cards[i];
  if (!c) return cards;
  const rect = { ...c, x: c.x + dx, y: c.y + dy };
  if (fits(cards, rect, i)) return placeCard(cards, i, rect);
  if (!inGrid(rect)) return cards;
  const hit = cards.map((other, k) => (k !== i && overlaps(other, rect) ? k : -1)).filter((k) => k >= 0);
  return hit.length === 1 ? swapCards(cards, i, hit[0]) : cards;
}

export const resizeCard = (cards, i, dw, dh) =>
  (cards[i] ? placeCard(cards, i, { ...cards[i], w: cards[i].w + dw, h: cards[i].h + dh }) : cards);

/* The rectangle with two cells at opposite corners, whichever way round the
   drag went. */
export function rectBetween(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

/* How many rows the cards reach down to. Rows below that take no space. */
export const usedRows = (cards) => cards.reduce((n, c) => Math.max(n, c.y + c.h - 1), 0);

/* The one-cell rectangles no card covers, row by row. */
export function freeCells(cards) {
  const out = [];
  for (let y = 1; y <= GRID_ROWS; y++) {
    for (let x = 1; x <= GRID_COLS; x++) {
      const cell = { x, y, w: 1, h: 1 };
      if (cards.every((c) => !overlaps(c, cell))) out.push(cell);
    }
  }
  return out;
}

/* How large a card's figure is drawn, from how many cells it covers: one
   cell is the stat card rung, two the next, three or more the headline. */
export function sizeOf(r) {
  const area = r.w * r.h;
  return area >= 3 ? "lg" : area === 2 ? "md" : "sm";
}
