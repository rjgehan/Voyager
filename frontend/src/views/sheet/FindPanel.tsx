// Find and replace (DESIGN §6.21.14), a panel over the grid's top right as in Google Sheets: the
// cells found, "3 of 12", the previous and next one (Enter and Shift+Enter), and with Replace open,
// Replace (this match, then the next) and Replace all (one undo step). Options: match case, match
// the entire cell, search within formulas, use a regular expression, all sheets. The grid stays
// usable meanwhile; Esc closes the panel.
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Workbook } from '../../sheets/engine';
import { findMatches, findPattern, replaceEdit, type FindMatch, type FindOptions } from '../../sheets/find';
import { toast } from '../../state/toasts';

interface Props {
  workbook: Workbook;
  /** Changes with every change of the workbook, so the matches are found again. */
  version: number;
  sheetId: string;
  /** The active cell (sheet coordinates), where Next and Previous start from. */
  active: FindMatch;
  editable: boolean;
  /** Open with Replace showing (Mod-H). */
  replace: boolean;
  onGo(match: FindMatch): void;
  onClose(): void;
}

type Position = [number, number, number];

/** Sheet order, then row by row, as the matches are listed. */
function position(order: Map<string, number>, m: FindMatch): Position {
  return [order.get(m.sheet) ?? 0, m.row, m.col];
}

const compare = (a: Position, b: Position) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function FindPanel({ workbook, version, sheetId, active, editable, replace: startReplacing, onGo, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [replacing, setReplacing] = useState(startReplacing && editable);
  const [opts, setOpts] = useState<Omit<FindOptions, 'query'>>({});
  const [current, setCurrent] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const options: FindOptions = { ...opts, query };
  const broken = query !== '' && findPattern(options) === null;
  const matches = useMemo(
    () => findMatches(workbook.file, sheetId, { ...opts, query }),
    // `version` says when the workbook changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workbook, version, sheetId, query, opts],
  );
  const order = new Map(workbook.file.sheets.map((s, i) => [s.id, i]));
  const index = current !== null && current < matches.length ? current : null;

  // Each opening (Mod-F again included) mounts the panel anew, with the find field focused.
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  /** Goes to the next (or previous) match from the active cell, wrapping around. */
  const go = (step: 1 | -1) => {
    if (matches.length === 0) return;
    const here = position(order, active);
    const on = index !== null && compare(position(order, matches[index]), here) === 0;
    let i: number;
    if (on && index !== null) i = (index + step + matches.length) % matches.length;
    else if (step === 1) {
      i = matches.findIndex((m) => compare(position(order, m), here) > 0);
      if (i < 0) i = 0;
    } else {
      i = matches.length - 1;
      while (i >= 0 && compare(position(order, matches[i]), here) >= 0) i--;
      if (i < 0) i = matches.length - 1;
    }
    setCurrent(i);
    onGo(matches[i]);
  };

  const replaceOne = () => {
    if (index === null || compare(position(order, matches[index]), position(order, active)) !== 0) {
      go(1);
      return;
    }
    const edit = replaceEdit(workbook.file, matches[index], options, replacement);
    if (edit) workbook.setCells([edit]);
    else toast('This cell shows a formula’s result: search within formulas to replace in its formula.');
    go(1);
  };

  const replaceAll = () => {
    const edits = matches.flatMap((m) => {
      const e = replaceEdit(workbook.file, m, options, replacement);
      return e ? [e] : [];
    });
    if (edits.length > 0) workbook.setCells(edits);
    toast(edits.length === 0 ? 'Nothing to replace.' : edits.length === 1 ? 'Replaced 1 cell.' : `Replaced ${edits.length} cells.`);
  };

  const set = (patch: Partial<FindOptions>) => {
    setOpts((o) => ({ ...o, ...patch }));
    setCurrent(null);
  };

  const count = query === '' ? '' : broken ? 'Not a valid expression' : matches.length === 0 ? 'No results' : index === null ? `${matches.length} found` : `${index + 1} of ${matches.length}`;
  return (
    <div
      className="sheet-find"
      role="search"
      aria-label="Find and replace"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="sheet-find-row">
        <input
          ref={input}
          className="text-input"
          type="search"
          aria-label="Find"
          placeholder="Find in sheet"
          value={query}
          aria-invalid={broken}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => {
            setQuery(e.target.value);
            setCurrent(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="sheet-find-count muted" aria-live="polite">
          {count}
        </span>
        <button type="button" className="icon-button" aria-label="Previous match" title="Previous (Shift+Enter)" disabled={matches.length === 0} onClick={() => go(-1)}>
          <ChevronUp size={16} />
        </button>
        <button type="button" className="icon-button" aria-label="Next match" title="Next (Enter)" disabled={matches.length === 0} onClick={() => go(1)}>
          <ChevronDown size={16} />
        </button>
        <button type="button" className="icon-button" aria-label="Close find" title="Close (Esc)" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {replacing && (
        <div className="sheet-find-row">
          <input
            className="text-input"
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceOne();
              }
            }}
          />
          <button type="button" className="button button-small" disabled={matches.length === 0} onClick={replaceOne}>
            Replace
          </button>
          <button type="button" className="button button-small" disabled={matches.length === 0} onClick={replaceAll}>
            Replace all
          </button>
        </div>
      )}
      <div className="sheet-find-options">
        <label className="checkbox-field">
          <input type="checkbox" checked={opts.matchCase === true} onChange={(e) => set({ matchCase: e.target.checked })} />
          Match case
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={opts.wholeCell === true} onChange={(e) => set({ wholeCell: e.target.checked })} />
          Match entire cell
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={opts.formulas === true} onChange={(e) => set({ formulas: e.target.checked })} />
          Search within formulas
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={opts.regex === true} onChange={(e) => set({ regex: e.target.checked })} />
          Regular expression
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={opts.allSheets === true} onChange={(e) => set({ allSheets: e.target.checked })} />
          All sheets
        </label>
        {editable && !replacing && (
          <button type="button" className="button button-small" onClick={() => setReplacing(true)}>
            Replace…
          </button>
        )}
      </div>
    </div>
  );
}
