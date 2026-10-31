/* ============================================================
   The Dashboard's cards, as the household arranged them.

   The cards sit on a grid 4 columns wide and 3 rows deep. Each card names a
   stat, the choice that stat needs (if any), and the rectangle of cells it
   covers: column x and row y of its top-left cell (from 1), w columns wide
   and h rows deep.

   Stored as JSON in app_meta under 'dashboardCards'. The stat ids belong to
   the renderer (renderer/lib/dashboardStats.js), which shows a card with an
   id it does not know as one asking for a stat. So this side checks only the
   shape: at most twelve cards, each naming a stat, inside the grid, none
   overlapping another, with any choice in the right form. A write with the
   wrong shape is refused before anything is stored.
   ============================================================ */
import type Database from 'better-sqlite3';
import type { DashboardCard } from '../../shared/types';
import { getMeta, setMeta } from './meta';

export const GRID_COLS = 4;
export const GRID_ROWS = 3;
const MAX_CARDS = GRID_COLS * GRID_ROWS;

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

const overlap = (a: DashboardCard, b: DashboardCard) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The card as it should be stored, or a sentence saying what is wrong. */
function checkCard(raw: unknown): DashboardCard | string {
  if (!raw || typeof raw !== 'object') return 'Each card has to be an object.';
  const c = raw as Record<string, unknown>;
  if (typeof c.stat !== 'string' || !c.stat || c.stat.length > 64) return 'Each card has to name a stat.';
  const { x, y, w, h } = c;
  if (!isWhole(x) || !isWhole(y) || !isWhole(w) || !isWhole(h) || x + w - 1 > GRID_COLS || y + h - 1 > GRID_ROWS) {
    return `Each card has to sit inside the grid of ${GRID_COLS} columns and ${GRID_ROWS} rows.`;
  }
  // Built in the order it is stored: the stat, its choice, then its place.
  const choice: Partial<DashboardCard> = {};
  if (c.of !== undefined) {
    const of = c.of as Record<string, unknown> | null;
    if (!of || (of.kind !== 'group' && of.kind !== 'category') || !isId(of.id)) {
      return 'A card can only look at a group or a category.';
    }
    choice.of = { kind: of.kind, id: of.id };
  }
  if (c.goal !== undefined) {
    if (!isId(c.goal)) return "A card's savings goal has to be a category.";
    choice.goal = c.goal;
  }
  if (c.percent !== undefined) {
    if (typeof c.percent !== 'number' || !(c.percent > 0 && c.percent <= 100)) {
      return "A card's share of income has to be between 1% and 100%.";
    }
    choice.percent = c.percent;
  }
  return { stat: c.stat, ...choice, x, y, w, h };
}

/** The cards as they should be stored, or a sentence saying what is wrong. */
function checkCards(list: unknown): DashboardCard[] | string {
  if (!Array.isArray(list) || list.length > MAX_CARDS) {
    return `The dashboard takes a list of at most twelve cards.`;
  }
  const cards: DashboardCard[] = [];
  for (const raw of list) {
    const card = checkCard(raw);
    if (typeof card === 'string') return card;
    if (cards.some((c) => overlap(c, card))) return 'Two cards on the dashboard overlap.';
    cards.push(card);
  }
  return cards;
}

/** The saved cards, or null when there are none or they can't be read.
 *  Never throws: a bad value here must not stop the app from starting. */
export function readDashboardCards(db: Database.Database): DashboardCard[] | null {
  const raw = getMeta(db, 'dashboardCards');
  if (!raw) return null;
  try {
    const cards = checkCards(JSON.parse(raw));
    return typeof cards === 'string' ? null : cards;
  } catch {
    return null;
  }
}

export function writeDashboardCards(db: Database.Database, cards: unknown): void {
  const checked = checkCards(cards);
  if (typeof checked === 'string') throw new Error(checked);
  setMeta(db, 'dashboardCards', JSON.stringify(checked));
}
