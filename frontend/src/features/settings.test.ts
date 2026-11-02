import { describe, expect, it } from 'vitest';
import type { Settings } from '../api/types';
import { DEFAULT_SETTINGS, noteWidth, noteWidthProps } from './settings';

const editor = (patch: Record<string, unknown>): Settings['editor'] => ({ ...DEFAULT_SETTINGS.editor, ...patch }) as Settings['editor'];

describe('note width (DESIGN §6.6)', () => {
  it('is 600 by default, a width in range, or full', () => {
    expect(noteWidth(DEFAULT_SETTINGS.editor)).toBe(600);
    expect(noteWidth(editor({ noteWidth: 950 }))).toBe(950);
    expect(noteWidth(editor({ noteWidth: 'full' }))).toBe('full');
    expect(noteWidth(editor({ noteWidth: 200 }))).toBe(600);
    expect(noteWidth(editor({ noteWidth: 5000 }))).toBe(1400);
  });

  it('reads the on/off readableLineLength of an older server', () => {
    const { noteWidth: _omitted, ...rest } = DEFAULT_SETTINGS.editor;
    void _omitted;
    expect(noteWidth({ ...rest, readableLineLength: false } as unknown as Settings['editor'])).toBe('full');
    expect(noteWidth({ ...rest, readableLineLength: true } as unknown as Settings['editor'])).toBe(600);
    expect(noteWidth(rest as unknown as Settings['editor'])).toBe(600);
  });

  it('caps the note column with --note-width, or leaves it at full width', () => {
    expect(noteWidthProps(editor({ noteWidth: 1000 }))).toEqual({ className: ' is-readable', style: { '--note-width': '1000px' } });
    expect(noteWidthProps(editor({ noteWidth: 'full' }))).toEqual({ className: '', style: undefined });
  });
});
