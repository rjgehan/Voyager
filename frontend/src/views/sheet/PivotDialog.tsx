// Create pivot table (DESIGN §6.21.17): the data range (its first row the headers), the column
// whose values make the rows, optionally one for the columns, the column to summarize and how.
import { useState } from 'react';
import { Modal } from '../../components/overlays/Modal';
import { toA1 } from '../../sheets/a1';
import { cellValue, sameName, type Sheet } from '../../sheets/format';
import { headerName, PIVOT_SUMMARIES, type PivotOptions, type PivotSummary } from '../../sheets/pivot';
import { parseRangeText, rangeText, type CellRange } from '../../sheets/refs';

interface Props {
  sheet: Sheet;
  /** The data the table starts from: the selection, or the data around the active cell. */
  initial: CellRange;
  onCreate(opts: PivotOptions): void;
  onClose(): void;
}

const SUMMARY_LABELS: Record<PivotSummary, string> = { SUM: 'Sum', COUNT: 'Count', AVERAGE: 'Average', MIN: 'Smallest', MAX: 'Largest' };

export function PivotDialog({ sheet, initial, onCreate, onClose }: Props) {
  const [text, setText] = useState(rangeText(initial));
  const parsed = parseRangeText(text);
  const range = parsed && (parsed.sheet === null || sameName(parsed.sheet, sheet.name)) ? parsed.range : null;
  const columns = range ? Array.from({ length: range.width }, (_, i) => range.col + i) : [];
  // The values to summarize: the first column after the first whose second row holds a number.
  const numericGuess = columns.find((c, i) => i > 0 && typeof cellValue(sheet.cells[toA1(c, (range?.row ?? 0) + 1)]) === 'number') ?? columns[columns.length - 1];
  const [rows, setRows] = useState<number | null>(null);
  const [cols, setCols] = useState<number | null>(null);
  const [values, setValues] = useState<number | null>(null);
  const [summary, setSummary] = useState<PivotSummary>('SUM');
  const rowCol = rows !== null && columns.includes(rows) ? rows : columns[0];
  const valueCol = values !== null && columns.includes(values) ? values : numericGuess;
  const colCol = cols !== null && columns.includes(cols) && cols !== rowCol ? cols : null;
  const error = !range ? `“${text}” is not a range of this sheet.` : range.height < 2 ? 'The range needs a header row and at least one row of data.' : null;
  const name = (c: number) => (range ? headerName(sheet, range, c) : '');
  return (
    <Modal label="Create pivot table" onClose={onClose} variant="sheet" className="sheet-cf-dialog">
      <form
        className="dialog sheet-cf-editor"
        onSubmit={(e) => {
          e.preventDefault();
          if (error || !range || rowCol === undefined || valueCol === undefined) return;
          onCreate({ range, rows: rowCol, ...(colCol !== null ? { cols: colCol } : {}), values: valueCol, summary });
        }}
      >
        <h2 className="dialog-title">Create pivot table</h2>
        <p className="dialog-message muted">A summary on a new sheet, made of formulas over the data, so its numbers stay current. Its groups are those of the data now: make it again when new ones appear.</p>
        <label className="field">
          <span className="field-label">Data range (with its header row)</span>
          <input className="text-input sheet-format-input" value={text} aria-invalid={error !== null} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={(e) => setText(e.target.value)} />
        </label>
        {error && <p className="field-error">{error}</p>}
        {!error && (
          <>
            <label className="field">
              <span className="field-label">Rows</span>
              <select className="text-input" value={rowCol} onChange={(e) => setRows(Number(e.target.value))}>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {name(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Columns</span>
              <select className="text-input" value={colCol ?? ''} onChange={(e) => setCols(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">None</option>
                {columns
                  .filter((c) => c !== rowCol)
                  .map((c) => (
                    <option key={c} value={c}>
                      {name(c)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Values</span>
              <select className="text-input" value={valueCol} onChange={(e) => setValues(Number(e.target.value))}>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {name(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Summarize by</span>
              <select className="text-input" value={summary} onChange={(e) => setSummary(e.target.value as PivotSummary)}>
                {PIVOT_SUMMARIES.map((s) => (
                  <option key={s} value={s}>
                    {SUMMARY_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={error !== null}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
