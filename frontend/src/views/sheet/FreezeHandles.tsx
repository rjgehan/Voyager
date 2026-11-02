// The freeze bars of the grid's corner (DESIGN §6.21.15), as in Google Sheets: a grey bar under the
// column letters and one beside the row numbers, at the edge of the frozen rows and columns. Drag one
// to freeze up to the row or column it is let go at; a line shows where. The bars are thin but take
// presses 12 px wide (44 px on touch devices).
import type { DataEditorRef } from '@glideapps/glide-data-grid';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { frozenRowAt, type GridLayout } from './gridModel';

interface Props {
  layout: GridLayout;
  /** Width of the row numbers. */
  markerWidth: number;
  /** Width of the frozen columns. */
  frozenWidth: number;
  touch: boolean;
  gridRef: RefObject<DataEditorRef | null>;
  wrapper: RefObject<HTMLDivElement | null>;
  /** Freeze `count` rows or columns (sheet rows; the frozen ones are never filtered). */
  onFreeze(axis: 'rows' | 'cols', count: number): void;
}

export function FreezeHandles({ layout, markerWidth, frozenWidth, touch, gridRef, wrapper, onFreeze }: Props) {
  const [drag, setDrag] = useState<{ axis: 'rows' | 'cols'; at: number; count: number } | null>(null);
  const moved = useRef(false);
  const band = layout.headerBand;
  const rowsEdge = band + layout.frozenHeight;
  const colsEdge = markerWidth + frozenWidth;

  /** The frozen count a pointer at (x, y) asks for, and the line's position for it. */
  const target = (axis: 'rows' | 'cols', clientX: number, clientY: number): { at: number; count: number } | null => {
    const box = wrapper.current?.getBoundingClientRect();
    if (!box) return null;
    const x = clientX - box.left;
    const y = clientY - box.top;
    if (axis === 'rows') {
      if (y <= band) return { at: band, count: 0 };
      if (y < rowsEdge) {
        const r = frozenRowAt(layout, y - band) ?? 0;
        let top = band;
        for (let i = 0; i < r; i++) top += layout.rowHeight(i);
        const h = layout.rowHeight(r);
        const after = y - top > h / 2;
        return { at: after ? top + h : top, count: after ? r + 1 : r };
      }
      const args = gridRef.current?.getMouseArgsForPosition(box.left + markerWidth + 4, clientY);
      if (args?.kind !== 'cell') return null;
      const row = args.location[1] + layout.frozenRows;
      const after = args.localEventY > args.bounds.height / 2;
      return { at: args.bounds.y - box.top + (after ? args.bounds.height : 0), count: layout.view.sheetRow(row) + (after ? 1 : 0) };
    }
    if (x <= markerWidth) return { at: markerWidth, count: 0 };
    const args = gridRef.current?.getMouseArgsForPosition(clientX, box.top + band / 2);
    if (!args || (args.kind !== 'header' && args.kind !== 'cell') || args.location[0] < 0) return null;
    const after = args.localEventX > args.bounds.width / 2;
    return { at: args.bounds.x - box.left + (after ? args.bounds.width : 0), count: args.location[0] + (after ? 1 : 0) };
  };

  const start = (axis: 'rows' | 'cols') => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    moved.current = false;
    setDrag({ axis, at: axis === 'rows' ? rowsEdge : colsEdge, count: axis === 'rows' ? layout.frozenRows : layout.frozenCols });
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const t = target(drag.axis, e.clientX, e.clientY);
    if (t) {
      moved.current = true;
      setDrag({ ...drag, ...t });
    }
  };
  const end = () => {
    if (drag && moved.current) onFreeze(drag.axis, Math.max(0, Math.min(1000, drag.count)));
    setDrag(null);
  };

  const hit = touch ? 44 : 12;
  return (
    <>
      <div
        className="sheet-freeze-handle is-rows"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to freeze rows"
        title="Drag to freeze rows"
        style={{ top: rowsEdge - hit / 2, left: 0, width: markerWidth, height: hit }}
        onPointerDown={start('rows')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => setDrag(null)}
      />
      <div
        className="sheet-freeze-handle is-cols"
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to freeze columns"
        title="Drag to freeze columns"
        style={{ left: colsEdge - hit / 2, top: 0, width: hit, height: band }}
        onPointerDown={start('cols')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => setDrag(null)}
      />
      {drag && <div className={`sheet-freeze-line is-${drag.axis}`} style={drag.axis === 'rows' ? { top: drag.at - 2 } : { left: drag.at - 2 }} aria-hidden />}
    </>
  );
}
