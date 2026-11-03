// A dropdown cell's list (DESIGN §6.21.13), under the cell as in Google Sheets: its items, the
// current one marked, a search when there are many; choosing one writes it to the cell.
import { Check } from 'lucide-react';
import { useState } from 'react';
import type { ScreenRect } from './SheetGrid';
import { SheetPopover } from './SheetPopover';

interface Props {
  items: string[];
  /** The cell's value as it shows. */
  current: string;
  /** `B4`, for the label. */
  cell: string;
  anchor: ScreenRect;
  phone: boolean;
  onPick(item: string): void;
  onClose(): void;
}

/** More items than this get a search field. */
const SEARCH_FROM = 8;

export function DropdownList({ items, current, cell, anchor, phone, onPick, onClose }: Props) {
  const [search, setSearch] = useState('');
  const shown = items.filter((i) => search === '' || i.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return (
    <SheetPopover label={`Choose a value for ${cell}`} anchor={anchor} phone={phone} className="sheet-dropdown" onClose={onClose}>
      <div className="sheet-dropdown-body">
        {/* On a phone the list fills the screen: it says which cell it is for, and has a way out. */}
        {phone && <p className="sheet-filter-title">Choose a value for {cell}</p>}
        {items.length > SEARCH_FROM && <input className="text-input" type="search" aria-label="Search the list" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />}
        {items.length === 0 ? (
          <p className="muted sheet-dropdown-empty">The dropdown has no items.</p>
        ) : (
          <ul className="sheet-dropdown-items" role="listbox" aria-label={`Values for ${cell}`}>
            {shown.map((item) => (
              <li key={item} role="presentation">
                <button type="button" role="option" aria-selected={item === current} className="sheet-dropdown-item" data-autofocus={item === current ? '' : undefined} onClick={() => onPick(item)}>
                  <span>{item}</span>
                  {item === current && <Check size={14} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {phone && (
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </SheetPopover>
  );
}
