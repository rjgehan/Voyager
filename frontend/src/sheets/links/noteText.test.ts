import { describe, expect, it } from 'vitest';
import { allFormulas, noteFormulas } from './noteText';

describe('a note’s formulas from its text (ROADMAP 42)', () => {
  it('reads top-level tables with their names and formats, and inline formulas', () => {
    const text = [
      '---',
      'title: x',
      '---',
      '# Costs `=1+1`',
      '',
      '| Item | Cost |',
      '|---|---|',
      '| Rent | 1,450 |',
      '| **Total** | =SUM(B2:B2) |',
      '',
      '^costs',
      '%% formats: B=currency %%',
      '',
      '```',
      '| a | b |',
      '|---|---|',
      '| `=9` | 1 |',
      '```',
      '',
      '%%',
      '| c |',
      '|---|',
      '%%',
      '',
      '> | quoted |',
      '> |---|',
      '',
      'a | b',
      '--|--',
      '1 | =A2',
    ].join('\n');
    const f = noteFormulas(text);
    expect(f.off).toBe(false);
    expect(f.model.tables.map((t) => t.name)).toEqual(['costs', 'Table2']);
    expect(f.model.tables[0].rows).toEqual([
      ['Item', 'Cost'],
      ['Rent', '1,450'],
      ['**Total**', '=SUM(B2:B2)'],
    ]);
    expect(f.model.tables[0].formats).toEqual({ 1: '$#,##0.00' });
    expect(f.model.tables[0].named).toBe(true);
    expect(f.inline).toEqual(['=1+1']);
    expect(allFormulas(f)).toEqual(['=SUM(B2:B2)', '=A2', '=1+1']);
  });

  it('turns off with formulas: false, and keeps CRLF notes readable', () => {
    const f = noteFormulas('---\r\nformulas: false\r\n---\r\n| a |\r\n|---|\r\n| =1 |\r\n');
    expect(f.off).toBe(true);
    expect(f.model.tables[0].rows).toEqual([['a'], ['=1']]);
    expect(allFormulas(f)).toEqual([]);
  });
});
