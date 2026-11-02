import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { trackedRange, trackedRangesField, trackRange, untrackRange } from './tracked';

function start(doc: string, from: number, to: number) {
  const state = EditorState.create({ doc, extensions: [trackedRangesField] });
  return state.update({ effects: trackRange.of({ id: 1, from, to }) }).state;
}

describe('tracked ranges (editor/tracked.ts)', () => {
  it('follow a line through edits above and below it, keeping text added at its edges outside', () => {
    let state = start('a\n- [ ] x\nb', 2, 9);
    state = state.update({ changes: [{ from: 0, insert: 'top\n' }, { from: state.doc.length, insert: '\nend' }] }).state;
    const r = trackedRange(state, 1)!;
    expect(state.doc.sliceString(r.from, r.to)).toBe('- [ ] x');
    // Typed at the line's start: the range no longer starts the line.
    state = state.update({ changes: { from: r.from, insert: 'Q' } }).state;
    const moved = trackedRange(state, 1)!;
    expect(state.doc.lineAt(moved.from).from).not.toBe(moved.from);
  });

  it('never turn around: text inserted at an empty range, or over a whole range, leaves a valid empty range', () => {
    let state = start('hello world', 5, 5);
    // Another device types exactly where an embed is waiting to go.
    state = state.update({ changes: { from: 5, insert: 'abc' } }).state;
    const point = trackedRange(state, 1)!;
    expect(point.from).toBeLessThanOrEqual(point.to);
    expect(() => state.update({ changes: { from: point.from, to: point.to, insert: '!' } })).not.toThrow();
    // The whole followed text replaced by other text.
    state = start('one two three', 4, 7);
    state = state.update({ changes: { from: 4, to: 7, insert: 'TWO' } }).state;
    const whole = trackedRange(state, 1)!;
    expect(whole.from).toBeLessThanOrEqual(whole.to);
    expect(state.doc.sliceString(whole.from, whole.to)).not.toBe('two');
  });

  it('collapse when their text is deleted, and stop when untracked', () => {
    let state = start('keep\n- [ ] x\n', 5, 12);
    state = state.update({ changes: { from: 4, to: 12 } }).state;
    const r = trackedRange(state, 1)!;
    expect(r.from).toBe(r.to);
    state = state.update({ effects: untrackRange.of(1) }).state;
    expect(trackedRange(state, 1)).toBeUndefined();
    expect(trackedRange(EditorState.create({ doc: '' }), 1)).toBeUndefined();
  });
});
