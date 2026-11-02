// Data validation rules (DESIGN §6.21.13), as Google Sheets' sidebar: the sheet's dropdowns and
// checkboxes with their ranges; a rule is a range with a dropdown of items, a dropdown of a range's
// values, or checkboxes, and what to do with other input (mark it, or refuse it). Each save or
// delete is one undo step.
import { Plus, Trash, X } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/overlays/Modal';
import type { Workbook } from '../../sheets/engine';
import { compareIds, sameName, type Sheet, type Validation, type ValidationType } from '../../sheets/format';
import { parseRangeText, rangeText } from '../../sheets/refs';
import { describeValidation } from '../../sheets/validation';

interface Props {
  workbook: Workbook;
  sheet: Sheet;
  /** The selection, offered as a new rule's range. */
  selection: string;
  editable: boolean;
  /** Open on a new rule of this kind (Insert dropdown) rather than on the list. */
  start?: ValidationType;
  onClose(): void;
}

type Draft = { id: string | null; v: Validation };

const KINDS: Array<{ type: ValidationType; label: string }> = [
  { type: 'list', label: 'Dropdown' },
  { type: 'range', label: 'Dropdown (from a range)' },
  { type: 'checkbox', label: 'Checkbox' },
];

export function ValidationDialog({ workbook, sheet, selection, editable, start, onClose }: Props) {
  const fresh = (type: ValidationType): Draft => ({ id: null, v: { range: selection, type, ...(type === 'list' ? { values: ['Option 1', 'Option 2'] } : {}) } });
  const [draft, setDraft] = useState<Draft | null>(() => (start && editable ? fresh(start) : null));
  const items = Object.entries(sheet.validation ?? {}).sort(([a], [b]) => compareIds(a, b));

  return (
    <Modal label="Data validation rules" onClose={onClose} variant="sheet" className="sheet-cf-dialog">
      <div className="dialog">
        <h2 className="dialog-title">Data validation rules</h2>
        {draft ? (
          <RuleEditor
            sheet={sheet}
            draft={draft}
            onCancel={() => (start && draft.id === null && items.length === 0 ? onClose() : setDraft(null))}
            onSave={(v) => {
              if (draft.id === null) workbook.addItem('validation', sheet.id, v);
              else workbook.setItem('validation', sheet.id, draft.id, v);
              if (start && draft.id === null) onClose();
              else setDraft(null);
            }}
          />
        ) : (
          <>
            {items.length === 0 ? (
              <p className="dialog-message muted">No data validation on this sheet yet. A rule gives a range's cells a dropdown, or makes them checkboxes.</p>
            ) : (
              <ul className="sheet-cf-list">
                {items.map(([id, v]) => (
                  <li key={id} className="sheet-cf-item">
                    <button type="button" className="sheet-cf-open" disabled={!editable} onClick={() => setDraft({ id, v })}>
                      <span className="sheet-cf-text">
                        <span>{describeValidation(v)}</span>
                        <span className="muted">
                          {v.range ?? ''}
                          {v.strict ? ' · other input refused' : ''}
                        </span>
                      </span>
                    </button>
                    {editable && (
                      <button type="button" className="icon-button" aria-label={`Delete rule: ${describeValidation(v)}, ${v.range ?? ''}`} title="Delete rule" onClick={() => workbook.setItem('validation', sheet.id, id, null)}>
                        <Trash size={16} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="dialog-actions dialog-actions-wrap">
              {editable && (
                <button type="button" className="button" onClick={() => setDraft(fresh('list'))}>
                  <Plus size={16} aria-hidden /> {items.length === 0 ? 'Add a rule' : 'Add another rule'}
                </button>
              )}
              <button type="button" className="button button-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function RuleEditor({ sheet, draft, onCancel, onSave }: { sheet: Sheet; draft: Draft; onCancel(): void; onSave(v: Validation): void }) {
  const [v, setV] = useState<Validation>(draft.v);
  const set = (patch: Partial<Validation>) => setV((x) => ({ ...x, ...patch }));
  const parsed = v.range ? parseRangeText(v.range) : null;
  const rangeError =
    !v.range?.trim() ? 'Choose the range the rule applies to, such as C2:C50.' : !parsed ? `“${v.range}” is not a range.` : parsed.sheet !== null && !sameName(parsed.sheet, sheet.name) ? 'A rule applies to a range of its own sheet.' : null;
  const values = v.values ?? [];
  const source = v.source ? parseRangeText(v.source) : null;
  const criteriaError =
    v.type === 'list' && values.every((x) => x.trim() === '') ? 'Give the dropdown at least one item.' : v.type === 'range' && !source ? 'Choose the range whose values the dropdown offers, such as Lists!A1:A9.' : null;

  const save = () => {
    if (rangeError || criteriaError || !parsed) return;
    const out: Validation = { range: rangeText(parsed.range), type: v.type };
    if (v.type === 'list') out.values = [...new Set(values.map((x) => x.trim()).filter((x) => x !== ''))];
    if (v.type === 'range') out.source = v.source?.trim();
    if (v.strict && v.type !== 'checkbox') out.strict = true;
    if (v.extra) out.extra = v.extra;
    onSave(out);
  };

  return (
    <form
      className="sheet-cf-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="field">
        <span className="field-label">Apply to range</span>
        <input className="text-input sheet-format-input" value={v.range ?? ''} aria-invalid={rangeError !== null} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={(e) => set({ range: e.target.value })} />
      </label>
      {rangeError && <p className="field-error">{rangeError}</p>}
      <label className="field">
        <span className="field-label">Criteria</span>
        <select className="text-input" value={v.type} onChange={(e) => set({ type: e.target.value as ValidationType })}>
          {KINDS.map((k) => (
            <option key={k.type} value={k.type}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {v.type === 'list' && (
        <fieldset className="sheet-cf-style">
          <legend className="field-label">Items</legend>
          {values.map((item, i) => (
            <div key={i} className="sheet-dv-item">
              <input
                className="text-input"
                aria-label={`Item ${i + 1}`}
                value={item}
                onChange={(e) => set({ values: values.map((x, j) => (j === i ? e.target.value : x)) })}
                onKeyDown={(e) => {
                  // Enter in the last item adds another, as in Google Sheets.
                  if (e.key === 'Enter' && i === values.length - 1 && item.trim() !== '') {
                    e.preventDefault();
                    set({ values: [...values, ''] });
                  }
                }}
              />
              <button type="button" className="icon-button" aria-label={`Remove item ${i + 1}`} disabled={values.length === 1} onClick={() => set({ values: values.filter((_, j) => j !== i) })}>
                <X size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="button button-small" onClick={() => set({ values: [...values, ''] })}>
            <Plus size={14} aria-hidden /> Add another item
          </button>
        </fieldset>
      )}
      {v.type === 'range' && (
        <label className="field">
          <span className="field-label">Values from the range</span>
          <input className="text-input sheet-format-input" value={v.source ?? ''} placeholder="Lists!A1:A9" spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={(e) => set({ source: e.target.value })} />
        </label>
      )}
      {v.type === 'checkbox' && <p className="dialog-message muted">The cells show checkboxes and hold TRUE when ticked, FALSE when not; empty cells are unticked.</p>}
      {criteriaError && <p className="field-error">{criteriaError}</p>}
      {v.type !== 'checkbox' && (
        <fieldset className="sheet-import-targets">
          <legend className="field-label">If the data is invalid</legend>
          <label className="checkbox-field">
            <input type="radio" name="strict" checked={!v.strict} onChange={() => set({ strict: false })} />
            Show a warning
          </label>
          <label className="checkbox-field">
            <input type="radio" name="strict" checked={v.strict === true} onChange={() => set({ strict: true })} />
            Reject the input
          </label>
        </fieldset>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button-primary" disabled={rangeError !== null || criteriaError !== null}>
          Done
        </button>
      </div>
    </form>
  );
}
