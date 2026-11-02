import { describe, expect, it } from 'vitest';
import { straightenFormula } from './smartQuotes';

describe('straightenFormula (iOS Smart Punctuation)', () => {
  it('makes a formula’s curly double quotes straight, and single ones outside strings', () => {
    expect(straightenFormula('=IF(A2>0,“yes”,“no”)')).toBe('=IF(A2>0,"yes","no")');
    expect(straightenFormula('=SUM(‘My sheet’!A1:A3)')).toBe("=SUM('My sheet'!A1:A3)");
    // An apostrophe typed inside a string stays as typed.
    expect(straightenFormula('=“Bob’s ”&‘Q1 plan’!B2')).toBe(`="Bob’s "&'Q1 plan'!B2`);
    expect(straightenFormula(' =„x‟')).toBe(' ="x"');
  });

  it('leaves text that is not a formula, and formulas without curly quotes, alone', () => {
    expect(straightenFormula('“Quoted” text')).toBe('“Quoted” text');
    expect(straightenFormula('=A1&"x"')).toBe('=A1&"x"');
  });
});
