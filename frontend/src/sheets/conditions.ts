// Conditions on a cell's value (DESIGN §6.21.11, §6.21.12), as Google Sheets offers them for filters
// and conditional formatting: empty or not, text that contains, starts or ends with or is exactly
// something (without regard to case, as the cell shows it), and comparisons of numbers. The values
// of a condition are typed input, so `10%`, `$5` and `2026-10-17` compare as the numbers they are.
// Pure and engine-free: the grid, embeds and filters evaluate conditions from cached values.
import type { CachedValue, Condition, ConditionKind } from './format';
import { typedInput } from './input';

export interface ConditionInfo {
  id: ConditionKind;
  label: string;
  /** How many values the condition takes. */
  values: 0 | 1 | 2;
}

export const CONDITIONS: readonly ConditionInfo[] = [
  { id: 'empty', label: 'Is empty', values: 0 },
  { id: 'notEmpty', label: 'Is not empty', values: 0 },
  { id: 'contains', label: 'Text contains', values: 1 },
  { id: 'notContains', label: 'Text does not contain', values: 1 },
  { id: 'startsWith', label: 'Text starts with', values: 1 },
  { id: 'endsWith', label: 'Text ends with', values: 1 },
  { id: 'textIs', label: 'Text is exactly', values: 1 },
  { id: 'gt', label: 'Greater than', values: 1 },
  { id: 'gte', label: 'Greater than or equal to', values: 1 },
  { id: 'lt', label: 'Less than', values: 1 },
  { id: 'lte', label: 'Less than or equal to', values: 1 },
  { id: 'eq', label: 'Is equal to', values: 1 },
  { id: 'neq', label: 'Is not equal to', values: 1 },
  { id: 'between', label: 'Is between', values: 2 },
  { id: 'notBetween', label: 'Is not between', values: 2 },
];

export function conditionInfo(kind: ConditionKind | undefined): ConditionInfo | undefined {
  return CONDITIONS.find((c) => c.id === kind);
}

/** A condition's value as a number (typed input: `10%` is 0.1), or null when it is text. */
export function conditionNumber(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null;
  const typed = typedInput(text.trim()).content;
  return typeof typed?.v === 'number' ? typed.v : null;
}

const lower = (s: string) => s.toLocaleLowerCase();

/**
 * Whether a cell (its value, and its text as it shows) meets `cond`. A condition without a kind
 * meets everything. Number comparisons need a number on both sides, except "is equal to" and "is
 * not equal to", which compare text (without case) when the condition's value is text.
 */
export function meetsCondition(cond: Condition, value: CachedValue, shown: string): boolean {
  const empty = value === null || value === '';
  const text = lower(shown);
  const v1 = cond.value ?? '';
  const v2 = cond.value2 ?? '';
  switch (cond.when) {
    case undefined:
      return true;
    case 'empty':
      return empty;
    case 'notEmpty':
      return !empty;
    case 'contains':
      return text.includes(lower(v1));
    case 'notContains':
      return !text.includes(lower(v1));
    case 'startsWith':
      return text.startsWith(lower(v1));
    case 'endsWith':
      return text.endsWith(lower(v1));
    case 'textIs':
      return text === lower(v1);
    case 'eq':
    case 'neq': {
      const n = conditionNumber(v1);
      const equal = n === null ? !empty && text === lower(v1.trim()) : typeof value === 'number' && value === n;
      return cond.when === 'eq' ? equal : !equal;
    }
  }
  if (typeof value !== 'number') return false;
  const a = conditionNumber(v1);
  if (a === null) return false;
  switch (cond.when) {
    case 'gt':
      return value > a;
    case 'gte':
      return value >= a;
    case 'lt':
      return value < a;
    case 'lte':
      return value <= a;
    case 'between':
    case 'notBetween': {
      const b = conditionNumber(v2);
      if (b === null) return false;
      const inside = value >= Math.min(a, b) && value <= Math.max(a, b);
      return cond.when === 'between' ? inside : !inside;
    }
  }
}

/** The condition in words, for lists of rules: `Greater than 100`, `Is between 1 and 5`. */
export function describeCondition(cond: Condition): string {
  const info = conditionInfo(cond.when);
  if (!info) return 'Any value';
  if (info.values === 0) return info.label;
  if (info.values === 1) return `${info.label} ${cond.value ?? ''}`.trim();
  return `${info.label} ${cond.value ?? ''} and ${cond.value2 ?? ''}`;
}
