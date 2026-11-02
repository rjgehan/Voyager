// What a note's property is as a spreadsheet value (ROADMAP item 42, DESIGN §6.45): `NOTEPROP` and
// the columns of `NOTEQUERY`. A frontmatter property by name (any case), else the note's file
// fields with Dataview's names (`file.name`, `file.mtime`, …, DESIGN §6.43.4), so a property and
// a column read the same in a query block and in a sheet. Pure.
import type { QueriedNote } from '../../api/types';

/** A spreadsheet value: text, a number, a boolean, nothing, a date or date-time (as serial days), or an error. */
export type LinkValue = string | number | boolean | null | { date: number; time: boolean } | { error: LinkError; message: string };

/** An error code as sheets show it (`#REF!`, `#N/A`, `#CYCLE!`, `#DIV/0!`, …). */
export type LinkError = string;

export function linkError(error: LinkError, message: string): LinkValue {
  return { error, message };
}

export const isLinkError = (v: LinkValue): v is { error: LinkError; message: string } => typeof v === 'object' && v !== null && 'error' in v;

const DAY_MS = 86_400_000;
/** 1899-12-30, day 0 of the sheets' serial dates (DESIGN §6.21.8). */
const EPOCH = Date.UTC(1899, 11, 30);

/** Serial days for a date (and time) as written, read as the device's wall time. */
export function serialOf(year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0): number {
  return (Date.UTC(year, month - 1, day, hours, minutes, seconds) - EPOCH) / DAY_MS;
}

/** An instant (`2026-10-22T09:56:00Z`) as serial days in the device's local time, as a sheet shows times. */
export function localSerial(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return serialOf(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `[[Plan]]` and `[[Plan|the plan]]` read as their text. */
function linkText(s: string): string {
  return s.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => alias ?? target);
}

/** A YAML value as a spreadsheet value: dates (`2026-11-05`) as dates, lists joined with commas. */
export function yamlValue(value: unknown): LinkValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const d = ISO_DATE.exec(value);
    if (d && validDate(+d[1], +d[2], +d[3])) return { date: serialOf(+d[1], +d[2], +d[3]), time: false };
    const t = ISO_DATETIME.exec(value);
    if (t && validDate(+t[1], +t[2], +t[3]) && +t[4] < 24 && +t[5] < 60) return { date: serialOf(+t[1], +t[2], +t[3], +t[4], +t[5], +(t[6] ?? 0)), time: true };
    return linkText(value);
  }
  if (Array.isArray(value)) return value.map((v) => textOf(yamlValue(v))).join(', ');
  return JSON.stringify(value);
}

/** A value as text (a list's item). */
function textOf(v: LinkValue): string {
  if (v === null) return '';
  if (typeof v === 'object') {
    if ('error' in v) return v.error;
    const ms = EPOCH + v.date * DAY_MS;
    const iso = new Date(ms).toISOString();
    return v.time ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
  }
  return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** The note's file fields by their Dataview names (`title` is the file's name unless a property says otherwise). */
function fileField(note: QueriedNote, name: string): LinkValue | undefined {
  switch (name) {
    case 'title':
    case 'file.name':
      return note.title;
    case 'file.path':
      return note.path;
    case 'file.folder':
      return folderOf(note.path);
    case 'file.mtime': {
      const s = localSerial(note.mtime);
      return s === null ? null : { date: s, time: true };
    }
    case 'file.mday': {
      const s = localSerial(note.mtime);
      return s === null ? null : { date: Math.floor(s), time: false };
    }
    case 'file.size':
      return note.size;
    case 'file.tags':
      return note.tags.map((t) => `#${t}`).join(', ');
    case 'file.aliases':
      return note.aliases.join(', ');
    case 'file.link':
      return `[[${note.title}]]`;
    default:
      return undefined;
  }
}

/** A note's property (or file field), or undefined when it has none by that name. */
export function propertyValue(note: QueriedNote, name: string): LinkValue | undefined {
  const wanted = name.trim();
  const lower = wanted.toLowerCase();
  const fm = note.frontmatter;
  if (fm && !lower.startsWith('file.')) {
    const key = Object.keys(fm).find((k) => k.toLowerCase() === lower);
    if (key !== undefined) return yamlValue(fm[key]);
  }
  return fileField(note, lower);
}
