/* ============================================================
   The upload classifier: predicts a statement row's category, or that it is
   a transfer, from the rows you have already imported. Pure TypeScript, no
   dependency, and never saved: it is trained afresh every time the review
   is read, so it always reflects your latest decisions.

   A row becomes a bag of tokens: the words of its cleaned descriptor, plus
   the bank's own signals (type:pos, bankcat:groceries), the account
   (acct:3) and a coarse amount band (amt:20-50). Tokens are weighted by
   TF-IDF, so a word most rows share counts for little and a rare one for a
   lot, and rows are compared by cosine similarity. Only rows that share a
   descriptor word are compared at all: the account, amount and bank signals
   tell similar descriptors apart, but never make two unrelated shops alike.

   The prediction is a vote among the K most similar training rows,
   weighted by similarity. Its confidence is the winner's share of the vote
   times the similarity of its closest supporter: an exact match that no
   neighbour contradicts is 1, a loose resemblance is low, and a tie between
   two categories is halved.
   ============================================================ */

/** A category id, or the transfer class. */
export type ClassLabel = number | 'transfer';

export interface ClassifierInput {
  descriptorClean: string;
  /** The bank's signals: { type, category } as the preset read them. */
  features: Record<string, string>;
  accountId: number;
  amountCents: number | null;
}

export interface TrainingExample extends ClassifierInput {
  label: ClassLabel;
}

export interface Prediction {
  label: ClassLabel;
  /** 0..1; compare with HIGH_CONFIDENCE and LOW_CONFIDENCE. */
  confidence: number;
}

export interface Classifier {
  /** The most likely class, or null when no training row resembles it. */
  predict(row: ClassifierInput): Prediction | null;
}

/** Neighbours that vote. */
export const K = 5;

/**
 * At or above HIGH_CONFIDENCE a prediction is trusted: the row starts with
 * that category and no warning. Between LOW_CONFIDENCE and HIGH_CONFIDENCE
 * it is pre-filled but labelled low_confidence ("Check category"). Below
 * LOW_CONFIDENCE there is no suggestion and the row is uncategorised.
 *
 * Starting values, to be tuned on the bootstrapped data (past months
 * imported and matched to their hand-typed entries): 0.6 is roughly "a
 * close match that most neighbours agree with", 0.3 "a loose resemblance".
 */
export const HIGH_CONFIDENCE = 0.6;
export const LOW_CONFIDENCE = 0.3;

/** The band an amount falls in, in pounds: what a spend's size says about
 *  it without making £12.40 and £12.41 different words. */
const AMOUNT_BANDS = [5, 20, 50, 100, 250, 1000];

function amountBand(cents: number | null): string | null {
  if (cents === null) return null;
  const pounds = cents / 100;
  const upper = AMOUNT_BANDS.findIndex((band) => pounds < band);
  if (upper === -1) return `amt:${AMOUNT_BANDS[AMOUNT_BANDS.length - 1]}+`;
  return `amt:${upper === 0 ? 0 : AMOUNT_BANDS[upper - 1]}-${AMOUNT_BANDS[upper]}`;
}

const lower = (text: string) => String(text || '').trim().toLowerCase();

/** The descriptor's words: lowercased, split on anything not a letter or
 *  digit, single characters dropped. */
function words(row: ClassifierInput): string[] {
  return lower(row.descriptorClean)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

/** The row's tokens, with repeats (a repeated word counts more). */
export function tokens(row: ClassifierInput): string[] {
  const out = [...words(row), `acct:${row.accountId}`];
  const type = lower(row.features?.type ?? '');
  if (type) out.push(`type:${type}`);
  const bankCategory = lower(row.features?.category ?? '');
  if (bankCategory) out.push(`bankcat:${bankCategory}`);
  const band = amountBand(row.amountCents);
  if (band) out.push(band);
  return out;
}

type Vector = Map<string, number>;

function counts(list: string[]): Vector {
  const v: Vector = new Map();
  for (const t of list) v.set(t, (v.get(t) ?? 0) + 1);
  return v;
}

/** TF-IDF weighted and scaled to length 1, so a dot product is the cosine. */
function weigh(tf: Vector, idf: Map<string, number>): Vector {
  const v: Vector = new Map();
  let norm = 0;
  for (const [t, n] of tf) {
    const w = n * (idf.get(t) ?? 0);
    if (w > 0) {
      v.set(t, w);
      norm += w * w;
    }
  }
  norm = Math.sqrt(norm);
  for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

function dot(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [t, w] of small) sum += w * (large.get(t) ?? 0);
  return sum;
}

export function train(examples: TrainingExample[]): Classifier {
  const docs = examples.map((ex) => counts(tokens(ex)));
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of doc.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  // Smoothed: a token in every row still weighs 1, a rare one more.
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log((1 + n) / (1 + d)) + 1);
  const vectors = docs.map((doc) => weigh(doc, idf));
  const wordSets = examples.map((ex) => new Set(words(ex)));

  return {
    predict(row) {
      const query = weigh(counts(tokens(row)), idf);
      const own = words(row);
      if (own.length === 0) return null;
      const neighbours = vectors
        .map((v, i) => ({
          sim: own.some((w) => wordSets[i].has(w)) ? dot(query, v) : 0,
          label: examples[i].label,
        }))
        .filter((nb) => nb.sim > 1e-9)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, K);
      if (neighbours.length === 0) return null;

      const votes = new Map<ClassLabel, { total: number; best: number }>();
      let all = 0;
      for (const nb of neighbours) {
        const v = votes.get(nb.label) ?? { total: 0, best: 0 };
        v.total += nb.sim;
        v.best = Math.max(v.best, nb.sim);
        votes.set(nb.label, v);
        all += nb.sim;
      }
      let winner: ClassLabel = neighbours[0].label;
      for (const [label, v] of votes) {
        if (v.total > (votes.get(winner) as { total: number }).total) winner = label;
      }
      const w = votes.get(winner) as { total: number; best: number };
      const confidence = Math.min(1, (w.total / all) * w.best);
      return { label: winner, confidence };
    },
  };
}
