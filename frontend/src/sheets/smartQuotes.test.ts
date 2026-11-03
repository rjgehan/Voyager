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

  it('keeps an apostrophe inside a quoted sheet name (Mom’s), straightening only the name’s own quotes', () => {
    expect(straightenFormula("='Mom’s'!B3")).toBe("='Mom’s'!B3");
    expect(straightenFormula('=‘Mom’s’!B2')).toBe("='Mom’s'!B2");
    expect(straightenFormula("=SUM('Mom’s'!A1:A3)+‘Q1 plan’!B2")).toBe("=SUM('Mom’s'!A1:A3)+'Q1 plan'!B2");
    // A sheet named Mom’, and a doubled '' inside a name.
    expect(straightenFormula("='Mom’'!B2")).toBe("='Mom’'!B2");
    expect(straightenFormula("='It''s ’'!B2")).toBe("='It''s ’'!B2");
    // While the name is being typed, its closing quote straightens once the ! follows.
    expect(straightenFormula('=‘My sheet’')).toBe("='My sheet’");
    expect(straightenFormula('=‘My sheet’!')).toBe("='My sheet'!");
  });

  it('leaves text that is not a formula, and formulas without curly quotes, alone', () => {
    expect(straightenFormula('“Quoted” text')).toBe('“Quoted” text');
    expect(straightenFormula('=A1&"x"')).toBe('=A1&"x"');
  });
});
