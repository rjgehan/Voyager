import { describe, expect, it } from 'vitest';
import type { QueriedNote } from '../../api/types';
import { localSerial, propertyValue, serialOf, yamlValue } from './values';

const note: QueriedNote = {
  path: 'Projects/Plan.md',
  title: 'Plan',
  aliases: ['P'],
  tags: ['work', 'q4'],
  frontmatter: { Status: 'open', due: '2026-11-05', at: '2026-11-05 14:30', owners: ['Ann', '[[Bob|Bobby]]'], n: 3, ok: true, empty: null, nested: { a: 1 } },
  mtime: '2026-10-22T09:30:00.000Z',
  size: 120,
  links: [],
  tasks: null,
};

describe('note properties as spreadsheet values (ROADMAP 42)', () => {
  it('reads properties in any case, typed', () => {
    expect(propertyValue(note, 'status')).toBe('open');
    expect(propertyValue(note, 'due')).toEqual({ date: serialOf(2026, 11, 5), time: false });
    expect(propertyValue(note, 'at')).toEqual({ date: serialOf(2026, 11, 5, 14, 30), time: true });
    expect(propertyValue(note, 'owners')).toBe('Ann, Bobby');
    expect(propertyValue(note, 'n')).toBe(3);
    expect(propertyValue(note, 'ok')).toBe(true);
    expect(propertyValue(note, 'empty')).toBeNull();
    expect(propertyValue(note, 'nested')).toBe('{"a":1}');
    expect(propertyValue(note, 'missing')).toBeUndefined();
  });

  it('reads the file fields by their Dataview names', () => {
    expect(propertyValue(note, 'title')).toBe('Plan');
    expect(propertyValue(note, 'file.name')).toBe('Plan');
    expect(propertyValue(note, 'file.path')).toBe('Projects/Plan.md');
    expect(propertyValue(note, 'file.folder')).toBe('Projects');
    expect(propertyValue(note, 'file.tags')).toBe('#work, #q4');
    expect(propertyValue(note, 'file.size')).toBe(120);
    expect(propertyValue(note, 'file.mtime')).toEqual({ date: localSerial(note.mtime)!, time: true });
    expect(propertyValue(note, 'file.mday')).toEqual({ date: Math.floor(localSerial(note.mtime)!), time: false });
  });

  it('counts serial days as the sheets do', () => {
    expect(serialOf(1899, 12, 30)).toBe(0);
    expect(serialOf(2026, 10, 17)).toBe(46312);
    expect(yamlValue('2026-13-45')).toBe('2026-13-45');
    expect(yamlValue('2026-02-29')).toBe('2026-02-29');
    expect(yamlValue(Number.NaN)).toBeNull();
  });
});
