// Conditional format rules (DESIGN §6.21.12), as Google Sheets' sidebar: the sheet's rules with a
// preview of their style, in the order they apply; a rule is a range with a condition and a style
// (presets, text and fill colour, bold, italic) or a colour scale (presets, or the smallest, middle
// and largest value's colours). Each save, and each delete, is one undo step.
import { Bold, Italic, Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/overlays/Modal';
import { DEFAULT_STYLE, readableText, SCALE_PRESETS, STYLE_PRESETS, type CellStyle } from '../../sheets/conditional';
import { CONDITIONS, conditionInfo, describeCondition } from '../../sheets/conditions';
import type { Workbook } from '../../sheets/engine';
import { compareIds, sameName, type ColorScale, type ConditionKind, type ConditionalRule, type Sheet } from '../../sheets/format';
import { parseRangeText, rangeText } from '../../sheets/refs';

interface Props {
  workbook: Workbook;
  sheet: Sheet;
  /** The selection, offered as a new rule's range. */
  selection: string;
  editable: boolean;
  onClose(): void;
}

type Draft = { id: string | null; rule: ConditionalRule };

/** A sample of a rule's look: `123` in its style, or its colour scale. */
function Preview({ rule }: { rule: ConditionalRule }) {
  if (rule.scale) {
    const stops = [rule.scale.min, ...(rule.scale.mid ? [rule.scale.mid] : []), rule.scale.max].join(', ');
    return <span className="sheet-cf-preview is-scale" style={{ background: `linear-gradient(to right, ${stops})` }} aria-hidden />;
  }
  return (
    <span
      className="sheet-cf-preview"
      style={{
        background: rule.bg,
        color: rule.color ?? (rule.bg ? readableText(rule.bg) : undefined),
        fontWeight: rule.bold ? 700 : undefined,
        fontStyle: rule.italic ? 'italic' : undefined,
      }}
      aria-hidden
    >
      123
    </span>
  );
}

const describe = (rule: ConditionalRule) => (rule.scale ? 'Colour scale' : describeCondition(rule));

export function ConditionalDialog({ workbook, sheet, selection, editable, onClose }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const rules = Object.entries(sheet.conditional ?? {}).sort(([a], [b]) => compareIds(a, b));

  const startNew = () => setDraft({ id: null, rule: { range: selection, when: 'notEmpty', ...DEFAULT_STYLE } });

  return (
    <Modal label="Conditional format rules" onClose={onClose} variant="sheet" className="sheet-cf-dialog">
      <div className="dialog">
        <h2 className="dialog-title">Conditional format rules</h2>
        {draft ? (
          <RuleEditor
            sheet={sheet}
            draft={draft}
            onCancel={() => setDraft(null)}
            onSave={(rule) => {
              if (draft.id === null) workbook.addItem('conditional', sheet.id, rule);
              else workbook.setItem('conditional', sheet.id, draft.id, rule);
              setDraft(null);
            }}
          />
        ) : (
          <>
            {rules.length === 0 ? (
              <p className="dialog-message muted">No rules on this sheet yet. A rule colours the cells of a range that meet a condition, or colours a range by its numbers.</p>
            ) : (
              <ul className="sheet-cf-list">
                {rules.map(([id, rule]) => (
                  <li key={id} className="sheet-cf-item">
                    <button type="button" className="sheet-cf-open" disabled={!editable} onClick={() => setDraft({ id, rule })}>
                      <Preview rule={rule} />
                      <span className="sheet-cf-text">
                        <span>{describe(rule)}</span>
                        <span className="muted">{rule.range ?? ''}</span>
                      </span>
                    </button>
                    {editable && (
                      <button type="button" className="icon-button" aria-label={`Delete rule: ${describe(rule)}, ${rule.range ?? ''}`} title="Delete rule" onClick={() => workbook.setItem('conditional', sheet.id, id, null)}>
                        <Trash size={16} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="dialog-actions dialog-actions-wrap">
              {editable && (
                <button type="button" className="button" onClick={startNew}>
                  <Plus size={16} aria-hidden /> {rules.length === 0 ? 'Add a rule' : 'Add another rule'}
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

function RuleEditor({ sheet, draft, onCancel, onSave }: { sheet: Sheet; draft: Draft; onCancel(): void; onSave(rule: ConditionalRule): void }) {
  const [rule, setRule] = useState<ConditionalRule>(draft.rule);
  const scale = rule.scale !== undefined;
  const info = conditionInfo(rule.when);
  const set = (patch: Partial<ConditionalRule>) => setRule((r) => ({ ...r, ...patch }));
  const parsed = rule.range ? parseRangeText(rule.range) : null;
  const rangeError =
    !rule.range?.trim() ? 'Choose the range the rule applies to, such as B2:B20.' : !parsed ? `“${rule.range}” is not a range.` : parsed.sheet !== null && !sameName(parsed.sheet, sheet.name) ? 'A rule applies to a range of its own sheet.' : null;
  const valueError = !scale && (info?.values ?? 0) >= 1 && !(rule.value ?? '').trim() ? 'Give the condition a value.' : !scale && (info?.values ?? 0) >= 2 && !(rule.value2 ?? '').trim() ? 'Give the condition both values.' : null;
  const setStyle = (style: CellStyle) => setRule((r) => ({ range: r.range, when: r.when, value: r.value, value2: r.value2, ...style, ...(r.extra ? { extra: r.extra } : {}) }));
  const setScale = (s: ColorScale) => setRule((r) => ({ range: r.range, scale: s, ...(r.extra ? { extra: r.extra } : {}) }));

  const save = () => {
    if (rangeError || valueError || !parsed) return;
    const out: ConditionalRule = { ...rule, range: rangeText(parsed.range) };
    for (const k of Object.keys(out) as Array<keyof ConditionalRule>) if (out[k] === undefined || out[k] === '' || out[k] === false) delete out[k];
    if (!scale) {
      const n = info?.values ?? 0;
      if (n < 2) delete out.value2;
      if (n < 1) delete out.value;
    }
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
        <input className="text-input sheet-format-input" value={rule.range ?? ''} aria-invalid={rangeError !== null} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={(e) => set({ range: e.target.value })} />
      </label>
      {rangeError && <p className="field-error">{rangeError}</p>}
      <div className="sheet-chart-kinds" role="radiogroup" aria-label="Kind of rule">
        <button type="button" role="radio" aria-checked={!scale} className="sheet-chart-kind" onClick={() => !scale || setStyle(DEFAULT_STYLE)}>
          Single colour
        </button>
        <button type="button" role="radio" aria-checked={scale} className="sheet-chart-kind" onClick={() => scale || setScale(SCALE_PRESETS[0])}>
          Colour scale
        </button>
      </div>
      {!scale ? (
        <>
          <label className="field">
            <span className="field-label">Format cells if…</span>
            <select className="text-input" value={rule.when ?? ''} onChange={(e) => set({ when: e.target.value as ConditionKind })}>
              {CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {(info?.values ?? 0) >= 1 && <input className="text-input" aria-label="Value" placeholder="Value or number" value={rule.value ?? ''} onChange={(e) => set({ value: e.target.value })} />}
          {(info?.values ?? 0) >= 2 && <input className="text-input" aria-label="Second value" placeholder="and" value={rule.value2 ?? ''} onChange={(e) => set({ value2: e.target.value })} />}
          {valueError && <p className="field-error">{valueError}</p>}
          <fieldset className="sheet-cf-style">
            <legend className="field-label">Formatting style</legend>
            <div className="sheet-cf-presets">
              {STYLE_PRESETS.map((p, i) => (
                <button key={i} type="button" className="sheet-cf-preset" aria-label={`Style ${i + 1}`} aria-pressed={p.bg === rule.bg && p.color === rule.color && !!p.bold === !!rule.bold} onClick={() => setStyle(p)}>
                  <Preview rule={p} />
                </button>
              ))}
            </div>
            <div className="sheet-cf-custom">
              <button type="button" className="icon-button" aria-label="Bold" aria-pressed={rule.bold === true} onClick={() => set({ bold: !rule.bold })}>
                <Bold size={16} />
              </button>
              <button type="button" className="icon-button" aria-label="Italic" aria-pressed={rule.italic === true} onClick={() => set({ italic: !rule.italic })}>
                <Italic size={16} />
              </button>
              <label className="sheet-cf-color">
                Text
                <input type="color" aria-label="Text colour" value={rule.color ?? '#000000'} onChange={(e) => set({ color: e.target.value })} />
              </label>
              <label className="sheet-cf-color">
                Fill
                <input type="color" aria-label="Fill colour" value={rule.bg ?? '#ffffff'} onChange={(e) => set({ bg: e.target.value })} />
              </label>
              <button type="button" className="button button-small" disabled={!rule.bg} onClick={() => set({ bg: undefined })}>
                No fill
              </button>
            </div>
            <p className="sheet-cf-sample">
              Preview: <Preview rule={rule} />
            </p>
          </fieldset>
        </>
      ) : (
        <fieldset className="sheet-cf-style">
          <legend className="field-label">Colour scale</legend>
          <div className="sheet-cf-presets">
            {SCALE_PRESETS.map((p, i) => (
              <button key={i} type="button" className="sheet-cf-preset" aria-label={`Scale ${i + 1}`} aria-pressed={JSON.stringify(p) === JSON.stringify(rule.scale)} onClick={() => setScale(p)}>
                <Preview rule={{ scale: p }} />
              </button>
            ))}
          </div>
          <div className="sheet-cf-custom">
            <label className="sheet-cf-color">
              Smallest
              <input type="color" aria-label="Smallest value's colour" value={rule.scale?.min} onChange={(e) => setScale({ ...(rule.scale as ColorScale), min: e.target.value })} />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={rule.scale?.mid !== undefined}
                onChange={(e) => {
                  const s = { ...(rule.scale as ColorScale) };
                  if (e.target.checked) s.mid = '#ffd666';
                  else delete s.mid;
                  setScale(s);
                }}
              />
              Median
            </label>
            {rule.scale?.mid !== undefined && <input type="color" aria-label="Median's colour" value={rule.scale.mid} onChange={(e) => setScale({ ...(rule.scale as ColorScale), mid: e.target.value })} />}
            <label className="sheet-cf-color">
              Largest
              <input type="color" aria-label="Largest value's colour" value={rule.scale?.max} onChange={(e) => setScale({ ...(rule.scale as ColorScale), max: e.target.value })} />
            </label>
          </div>
        </fieldset>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button-primary" disabled={rangeError !== null || valueError !== null}>
          Done
        </button>
      </div>
    </form>
  );
}
