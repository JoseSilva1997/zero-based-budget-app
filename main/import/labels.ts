/* ============================================================
   Labels: what the review says about an upload row, and what the row
   effectively is once its labels and your decisions are put together.
   Pure, and never stored: possible_duplicate, already_imported and
   not_in_month depend on database state that changes while a batch is
   pending, so labels are recomputed on every read of the review.

   Severity decides the default tick:
   - block: the row can't be ticked, whatever was stored (money in, already
     imported, unreadable, not completed; no category until one is picked);
   - warn: it starts unticked, and you may tick it;
   - info: a transfer, unticked until you switch it back to a spend;
   - none: 'ok', no chip, ticked.

   A row the bank already rules out (a hard block) carries only that label:
   whether it is a duplicate, or which category it would be, is noise.
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
  uncategorised: { severity: 'block', text: 'No category' },
  low_confidence: { severity: 'warn', text: 'Check category' },
  not_in_month: { severity: 'warn', text: "Not in this month's plan" },
  possible_duplicate: { severity: 'warn', text: 'Possible duplicate' },
  out_of_month: { severity: 'warn', text: 'Outside this month' },
  transfer: { severity: 'info', text: 'Transfer' },
  credit: { severity: 'block', text: 'Money in' },
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
}

export interface RowAssessment {
  labels: Label[];
  categoryId: number | null;
  name: string;
  kind: 'spend' | 'transfer';
  included: boolean;
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
  if (f.direction === 'credit') hard.push(label('credit'));
  if (f.notCompleted) hard.push(label('not_completed'));
  if (f.alreadyImported) hard.push(label('already_imported'));
  if (hard.length > 0) return { labels: hard, categoryId, name, kind, included: false };

  const labels: Label[] = [];
  // Whatever decided the kind or category was the classifier's middling guess.
  const guessed = kind === 'transfer' ? s.kind === null : s.categoryId === null;
  if (guessed && p && p.confidence < HIGH_CONFIDENCE) labels.push(label('low_confidence'));
  if (kind === 'transfer') {
    labels.push(label('transfer'));
  } else if (categoryId === null) {
    labels.push(label('uncategorised'));
  } else if (!f.inMonth(categoryId)) {
    labels.push(label('not_in_month'));
  }
  if (f.duplicates > 0) labels.push(label('possible_duplicate'));
  if (f.spentOn && f.spentOn.slice(0, 7) !== f.monthKey) labels.push(label('out_of_month'));

  const blocked = labels.some((l) => l.severity === 'block');
  const importable = !blocked && kind === 'spend' && categoryId !== null && s.linkedEntryId === null;
  const byDefault = labels.length === 0;
  const included = importable && (s.included === null ? byDefault : s.included === 1);
  return { labels: labels.length ? labels : [label('ok')], categoryId, name, kind, included };
}
