// A filter column's menu (DESIGN §6.21.11), as in Google Sheets: sort A → Z or Z → A (the rows as
// the view shows them; the cells stay where they are), filter by condition, and filter by values
// with a search, Select all and Clear. OK applies the column's conditions as one undo step.
import { ArrowDownAZ, ArrowUpZA } from 'lucide-react';
import { useMemo, useState } from 'react';
import { columnLetters } from '../../sheets/a1';
import { CONDITIONS, conditionInfo } from '../../sheets/conditions';
import { filterValues } from '../../sheets/filter';
import type { ConditionKind, FilterColumn, Sheet, SheetFilter } from '../../sheets/format';
import type { ScreenRect } from './SheetGrid';
import { SheetPopover } from './SheetPopover';

/** Values listed at most; a search narrows longer lists. */
const LIST_LIMIT = 500;

interface Props {
  sheet: Sheet;
  filter: SheetFilter;
  col: number;
  anchor: ScreenRect;
  phone: boolean;
  editable: boolean;
  /** The column's new conditions (null: none). */
  onApply(column: FilterColumn | null): void;
  onSort(desc: boolean): void;
  onClose(): void;
}

export function FilterMenu({ sheet, filter, col, anchor, phone, editable, onApply, onSort, onClose }: Props) {
  const letters = columnLetters(col);
  const current = filter.cols[letters];
  const values = useMemo(() => filterValues(sheet, filter, col), [sheet, filter, col]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(current?.hide ?? []));
  const [when, setWhen] = useState<ConditionKind | ''>(current?.when ?? '');
  const [value, setValue] = useState(current?.value ?? '');
  const [value2, setValue2] = useState(current?.value2 ?? '');
  const [search, setSearch] = useState('');
  const info = conditionInfo(when || undefined);
  const shown = values.filter((v) => search === '' || v.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const sort = filter.sort?.col === letters ? (filter.sort.desc ? 'desc' : 'asc') : null;

  const toggle = (text: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });
  // Select all and Clear act on the values the search shows, as in Google Sheets.
  const setAll = (hide: boolean) =>
    setHidden((h) => {
      const next = new Set(h);
      for (const v of shown) {
        if (hide) next.add(v.text);
        else next.delete(v.text);
      }
      return next;
    });

  const apply = () => {
    const column: FilterColumn = { ...(current?.extra ? { extra: current.extra } : {}) };
    // Hidden values that no longer occur stay hidden, as typed elsewhere.
    const hide = [...hidden].sort();
    if (hide.length > 0) column.hide = hide;
    if (when) {
      column.when = when;
      if ((info?.values ?? 0) >= 1) column.value = value;
      if ((info?.values ?? 0) >= 2) column.value2 = value2;
    }
    onApply(Object.keys(column).length > 0 ? column : null);
  };

  const showing = values.filter((v) => !hidden.has(v.text)).length;
  return (
    <SheetPopover label={`Filter column ${letters}`} anchor={anchor} phone={phone} className="sheet-filter-menu" onClose={onClose}>
      <form
        className="sheet-filter-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (editable) apply();
        }}
      >
        <p className="sheet-filter-title">Column {letters}</p>
        <div className="sheet-filter-sorts">
          <button type="button" className="sheet-filter-sort" aria-pressed={sort === 'asc'} disabled={!editable} onClick={() => onSort(false)}>
            <ArrowDownAZ size={16} aria-hidden />
            Sort A → Z
          </button>
          <button type="button" className="sheet-filter-sort" aria-pressed={sort === 'desc'} disabled={!editable} onClick={() => onSort(true)}>
            <ArrowUpZA size={16} aria-hidden />
            Sort Z → A
          </button>
        </div>
        <fieldset className="sheet-filter-section">
          <legend className="field-label">Filter by condition</legend>
          <select className="text-input" aria-label="Condition" value={when} disabled={!editable} onChange={(e) => setWhen(e.target.value as ConditionKind | '')}>
            <option value="">None</option>
            {CONDITIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {(info?.values ?? 0) >= 1 && <input className="text-input" aria-label="Value" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />}
          {(info?.values ?? 0) >= 2 && <input className="text-input" aria-label="Second value" placeholder="and" value={value2} onChange={(e) => setValue2(e.target.value)} />}
        </fieldset>
        <fieldset className="sheet-filter-section">
          <legend className="field-label">Filter by values</legend>
          <input className="text-input" type="search" aria-label="Search values" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="sheet-filter-bulk">
            <button type="button" className="button button-small" disabled={!editable} onClick={() => setAll(false)}>
              Select all
            </button>
            <button type="button" className="button button-small" disabled={!editable} onClick={() => setAll(true)}>
              Clear
            </button>
            <span className="muted">
              {showing} of {values.length} shown
            </span>
          </div>
          <ul className="sheet-filter-values" aria-label="Values">
            {shown.slice(0, LIST_LIMIT).map((v) => (
              <li key={v.text}>
                <label className="checkbox-field sheet-filter-value">
                  <input type="checkbox" checked={!hidden.has(v.text)} disabled={!editable} onChange={() => toggle(v.text)} />
                  <span className="sheet-filter-value-text">{v.text === '' ? '(Blanks)' : v.text}</span>
                  <span className="muted">{v.count}</span>
                </label>
              </li>
            ))}
            {shown.length > LIST_LIMIT && <li className="muted">{shown.length - LIST_LIMIT} more: search to find them.</li>}
          </ul>
        </fieldset>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={!editable}>
            OK
          </button>
        </div>
      </form>
    </SheetPopover>
  );
}
