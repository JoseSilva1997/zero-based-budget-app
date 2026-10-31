/* ============================================================
   Labels: what the review says about an upload row, and what the row
   effectively is once its labels and your decisions are put together.
   Pure, and never stored: possible_duplicate, already_imported and
   not_in_month depend on database state that changes while a batch is
   pending, so labels are recomputed on every read of the review.

   Severity decides the default tick:
   - block: the row can't be ticked, whatever was stored (already imported,
     unreadable, not completed);
   - warn: it starts unticked, and you may tick it;
   - info: a transfer, unticked until you switch it back to a spend. It
     writes nothing, so it carries no other chip;
   - none: 'ok', no chip, ticked.

   One rule stands apart from severity: a spend with no category can't be
   ticked until one is picked, since there is no line to write it to. Its
   'uncategorised' chip is only a warning, though: on a first import, before
   the classifier has learnt anything, nearly every row is one, and a wall of
   refusals would hide the rows that really are refused.

   A row the bank already rules out (a hard block) carries only that label:
   whether it is a duplicate, or which category it would be, is noise.

   Money in is a refund when it has a purchase (suggested, or chosen): of a
   purchase in this month it is written as a negative entry on that
   purchase's line ('refund'); of an earlier month's, as money back, an
   income line in this month ('money_back'). Both start ticked. Money in
   with no purchase ('credit', "Money in") starts unticked, and ticked is
   written as money back too: cashback, a friend paying you back, but also a
   salary, which your planned income already counts. A refund of a purchase
   in this upload that isn't being imported can't be ticked
   ('purchase_skipped'): what was never counted can't be given back.

   A row can teach without being imported: an unticked spend whose category
   you picked, not matched to an entry and not blocked, trains the classifier
   once its batch is confirmed, though it writes no entry. A category the
   classifier guessed never teaches, so it can't learn from its own guesses.
   ============================================================ */
import { HIGH_CONFIDENCE, LOW_CONFIDENCE, type Prediction } from './classifier';

export type LabelKey =
  | 'ok'
  | 'uncategorised'
  | 'low_confidence'
  | 'not_in_month'
  | 'possible_duplicate'
  | 'out_of_month'
  | 'transfer'
  | 'credit'
  | 'refund'
  | 'money_back'
  | 'purchase_skipped'
  | 'already_imported'
  | 'parse_error'
  | 'not_completed';

export type Severity = 'none' | 'info' | 'warn' | 'block';

export interface Label {
  key: LabelKey;
  severity: Severity;
  /** The chip's text; empty for 'ok', which has no chip. */
  text: string;
}

export const LABELS: Record<LabelKey, { severity: Severity; text: string }> = {
  ok: { severity: 'none', text: '' },
  uncategorised: { severity: 'warn', text: 'No category' },
  low_confidence: { severity: 'warn', text: 'Check category' },
  not_in_month: { severity: 'warn', text: "Not in this month's plan" },
  possible_duplicate: { severity: 'warn', text: 'Possible duplicate' },
  out_of_month: { severity: 'warn', text: 'Outside this month' },
  transfer: { severity: 'info', text: 'Transfer' },
  credit: { severity: 'warn', text: 'Money in' },
  refund: { severity: 'info', text: 'Refund' },
  money_back: { severity: 'info', text: 'Money back' },
  purchase_skipped: { severity: 'warn', text: 'Purchase not imported' },
  already_imported: { severity: 'block', text: 'Already imported' },
  parse_error: { severity: 'block', text: "Couldn't read" },
  not_completed: { severity: 'block', text: 'Not completed' },
};

/** Your decisions on a row, as stored: null means "use the default". */
export interface RowDecisions {
  categoryId: number | null;
  name: string | null;
  kind: 'spend' | 'transfer' | null;
  included: 0 | 1 | null;
  linkedEntryId: number | null;
}

export interface RowFacts {
  /** The batch's month, 'YYYY-MM'. */
  monthKey: string;
  spentOn: string | null;
  direction: 'debit' | 'credit' | null;
  descriptorClean: string;
  parseError: string | null;
  notCompleted: boolean;
  alreadyImported: boolean;
  /** How many existing entries it might duplicate. */
  duplicates: number;
  prediction: Prediction | null;
  /** True when the category has a plan line in the batch's month. */
  inMonth(categoryId: number): boolean;
  stored: RowDecisions;
  /** Money in only: where its purchase is, or null for none. 'skipped': a
   *  row of this upload that won't be imported. */
  refundTarget?: 'same_month' | 'earlier_month' | 'skipped' | null;
}

/** What confirming writes for the row, if it is ticked: an entry, a
 *  refund (a negative entry), or money back (an income line). */
export type WritesAs = 'entry' | 'refund' | 'money_back' | null;

export interface RowAssessment {
  labels: Label[];
  categoryId: number | null;
  name: string;
  kind: 'spend' | 'transfer';
  included: boolean;
  /** Confirming would train the classifier on this row without importing it. */
  teaches: boolean;
  writesAs: WritesAs;
}

const label = (key: LabelKey): Label => ({ key, ...LABELS[key] });

export function assessRow(f: RowFacts): RowAssessment {
  const s = f.stored;
  const p = f.prediction && f.prediction.confidence >= LOW_CONFIDENCE ? f.prediction : null;
  const kind = s.kind ?? (p?.label === 'transfer' ? 'transfer' : 'spend');
  const categoryId = s.categoryId ?? (p && p.label !== 'transfer' ? p.label : null);
  const name = s.name ?? f.descriptorClean;

  const hard: Label[] = [];
  if (f.parseError) hard.push(label('parse_error'));
  if (f.notCompleted) hard.push(label('not_completed'));
  if (f.alreadyImported) hard.push(label('already_imported'));
  if (hard.length > 0) return { labels: hard, categoryId, name, kind, included: false, teaches: false, writesAs: null };
  // A transfer writes nothing, so no other chip has anything to say about it.
  if (kind === 'transfer') {
    return { labels: [label('transfer')], categoryId: f.direction === 'credit' ? null : categoryId, name, kind, included: false, teaches: false, writesAs: null };
  }
  if (f.direction === 'credit') return assessMoneyIn(f, name);

  const labels: Label[] = [];
  // Whatever decided the kind or category was the classifier's middling guess.
  if (s.categoryId === null && p && p.confidence < HIGH_CONFIDENCE) labels.push(label('low_confidence'));
  if (categoryId === null) {
    labels.push(label('uncategorised'));
  } else if (!f.inMonth(categoryId)) {
    labels.push(label('not_in_month'));
  }
  if (f.duplicates > 0) labels.push(label('possible_duplicate'));
  if (f.spentOn && f.spentOn.slice(0, 7) !== f.monthKey) labels.push(label('out_of_month'));

  const blocked = labels.some((l) => l.severity === 'block');
  // No category, no tick: the rule 'uncategorised' carries, whatever its chip.
  const importable = !blocked && kind === 'spend' && categoryId !== null && s.linkedEntryId === null;
  const byDefault = labels.length === 0;
  const included = importable && (s.included === null ? byDefault : s.included === 1);
  const teaches = !included && kind === 'spend' && s.categoryId !== null && s.linkedEntryId === null;
  return {
    labels: labels.length ? labels : [label('ok')],
    categoryId,
    name,
    kind,
    included,
    teaches,
    writesAs: kind === 'spend' ? 'entry' : null,
  };
}

/** Money in: a refund, money back, or a transfer in. Its category is its
 *  purchase's, which the caller knows, so none is predicted or kept here;
 *  and it never teaches the classifier. */
function assessMoneyIn(f: RowFacts, name: string): RowAssessment {
  const s = f.stored;
  const target = f.refundTarget ?? null;
  const labels: Label[] = [];
  let writesAs: WritesAs = null;
  if (target === 'skipped') {
    labels.push(label('purchase_skipped'));
  } else if (target === 'same_month') {
    labels.push(label('refund'));
    writesAs = 'refund';
  } else if (target === 'earlier_month') {
    labels.push(label('money_back'));
    writesAs = 'money_back';
  } else {
    labels.push(label('credit'));
    writesAs = 'money_back';
  }
  if (f.spentOn && f.spentOn.slice(0, 7) !== f.monthKey) labels.push(label('out_of_month'));
  const importable = writesAs !== null;
  const byDefault = labels.every((l) => l.key === 'refund' || l.key === 'money_back');
  const included = importable && (s.included === null ? byDefault : s.included === 1);
  return { labels, categoryId: null, name, kind: 'spend', included, teaches: false, writesAs };
}
