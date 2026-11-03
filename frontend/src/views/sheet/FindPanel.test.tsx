import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Workbook } from '../../sheets/engine';
import { cellValue, parseSheet, type SheetCell } from '../../sheets/format';
import type { FindMatch } from '../../sheets/find';
import { useToasts } from '../../state/toasts';
import { FindPanel } from './FindPanel';

function open(cells: Record<string, SheetCell>): Workbook {
  const parsed = parseSheet(JSON.stringify({ type: 'notesapp-sheet', version: 1, engine: '', sheets: [{ id: 's1', name: 'S', cells }] }));
  if (!parsed.ok) throw new Error(parsed.error);
  return Workbook.open(parsed.file);
}

/** The panel over a workbook, with the editor's part played here: `hidden` rows cannot be selected. */
function Harness({ workbook, start, hidden = [] }: { workbook: Workbook; start: FindMatch; hidden?: number[] }) {
  const [active, setActive] = useState(start);
  const [version, setVersion] = useState(0);
  useEffect(() => workbook.subscribe(() => setVersion((v) => v + 1)), [workbook]);
  const onGo = (m: FindMatch) => {
    // As SheetEditor's showRange: a row the filter hides selects the next row that shows.
    let row = m.row;
    while (hidden.includes(row)) row++;
    setActive({ ...m, row });
    return { ...m, row };
  };
  return (
    <>
      <output aria-label="Active">{`${active.col},${active.row}`}</output>
      <FindPanel workbook={workbook} version={version} sheetId="s1" active={active} editable replace onGo={onGo} onClose={() => {}} />
    </>
  );
}

const value = (wb: Workbook, ref: string) => cellValue(wb.file.sheets[0].cells[ref]);

function setUp(workbook: Workbook, start: FindMatch, hidden?: number[]) {
  render(<Harness workbook={workbook} start={start} hidden={hidden} />);
  const panel = screen.getByRole('search', { name: 'Find and replace' });
  fireEvent.change(within(panel).getByRole('searchbox', { name: 'Find' }), { target: { value: 'x' } });
  fireEvent.change(within(panel).getByRole('textbox', { name: 'Replace with' }), { target: { value: 'y' } });
  return {
    panel,
    next: () => fireEvent.keyDown(within(panel).getByRole('searchbox', { name: 'Find' }), { key: 'Enter' }),
    replace: () => act(() => fireEvent.click(within(panel).getByRole('button', { name: 'Replace' }))),
    active: () => screen.getByRole('status', { hidden: true, name: 'Active' }).textContent,
  };
}

describe('FindPanel: Replace (DESIGN §6.21.14)', () => {
  it('replaces the selected match with every press and counts the matches that are left', () => {
    const wb = open({ A1: { v: 'x' }, A2: { v: 'x' }, A3: { v: 'x' } });
    const { panel, next, replace, active } = setUp(wb, { sheet: 's1', col: 3, row: 9 });
    next();
    expect(active()).toBe('0,0');
    expect(within(panel).getByText('1 of 3')).toBeInTheDocument();
    replace();
    expect(value(wb, 'A1')).toBe('y');
    expect(active()).toBe('0,1');
    expect(within(panel).getByText('1 of 2')).toBeInTheDocument();
    replace();
    expect(value(wb, 'A2')).toBe('y');
    expect(active()).toBe('0,2');
    expect(within(panel).getByText('1 of 1')).toBeInTheDocument();
    replace();
    expect(value(wb, 'A3')).toBe('y');
    expect(within(panel).getByText('No results')).toBeInTheDocument();
  });

  it('replaces a match in a row the filter hides when the panel points at it', () => {
    const wb = open({ A1: { v: 'Name' }, A2: { v: 'x' }, A3: { v: 'x' }, A4: { v: 'x' } });
    // Sheet row 3 (index 2) is hidden: going to A3 selects A4.
    const { panel, next, replace, active } = setUp(wb, { sheet: 's1', col: 0, row: 0 }, [2]);
    next();
    expect(active()).toBe('0,1');
    replace();
    expect(value(wb, 'A2')).toBe('y');
    expect(within(panel).getByText('1 of 2')).toBeInTheDocument();
    expect(active()).toBe('0,3');
    replace();
    expect(value(wb, 'A3')).toBe('y');
    expect(value(wb, 'A4')).toBe('x');
    expect(within(panel).getByText('1 of 1')).toBeInTheDocument();
    expect(active()).toBe('0,3');
    replace();
    expect(value(wb, 'A4')).toBe('y');
  });

  it('says why a value that matched only as it shows is not replaced, and a formula’s result likewise', () => {
    useToasts.setState({ toasts: [] });
    const wb = open({ A1: { v: 1450, fmt: '$#,##0.00' }, A2: { f: '=A1', fmt: '$#,##0.00' } });
    const { panel, next, replace } = setUp(wb, { sheet: 's1', col: 3, row: 9 });
    fireEvent.change(within(panel).getByRole('searchbox', { name: 'Find' }), { target: { value: '1,4' } });
    next();
    replace();
    expect(value(wb, 'A1')).toBe(1450);
    expect(useToasts.getState().toasts.at(-1)?.message).toMatch(/number format/);
    // Replace went on to the next match, the formula.
    replace();
    expect(useToasts.getState().toasts.at(-1)?.message).toMatch(/formula’s result/);
  });
});
