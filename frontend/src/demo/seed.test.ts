// The GitHub Pages demo's showcase vault (DESIGN §6.45): every file must open in its view, and the
// vault must show each headline feature with data dated around today.
import { describe, expect, it } from 'vitest';
import { createMockServer } from '../api/mock/server';
import { MockVault } from '../api/mock/vault';
import type { DatedNotesResponse, FlashcardNotesResponse, HabitsResponse, TaskListsResponse, TasksResponse } from '../api/types';
import { DEFAULT_FLASHCARD_CONFIG } from '../api/mock/features';
import { parseCards } from '../flashcards/parse';
import { parseSheet } from '../sheets/format';
import { localToday } from '../tasks/dates';
import { parseCanvas } from '../views/canvas/format';
import { parseDrawing } from '../views/excalidraw/format';
import { isKanbanText } from '../views/kanban/detect';
import { parseBoard } from '../views/kanban/format';
import { dayOffset, demoSeedFiles } from './seed';

const files = demoSeedFiles();
const text = (path: string) => {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`no ${path}`);
  return f.content;
};

describe('the demo vault', () => {
  it('has unique paths, a Welcome note and no personal data', () => {
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
    expect(files.map((f) => f.path)).toContain('Welcome.md');
    const all = files.map((f) => f.content).join('\n');
    expect(all).not.toMatch(/@[a-z0-9-]+\.(com|net|org)|ts\.net|rgehan/i);
  });

  it('dates its daily notes, meetings and tasks around today', () => {
    expect(dayOffset(0)).toBe(localToday());
    expect(files.some((f) => f.path === `Daily/${localToday()}.md`)).toBe(true);
    const handle = createMockServer(new MockVault(files));
    const call = <T>(path: string, params = '') => handle({ method: 'GET', path, params: new URLSearchParams(params), body: null, origin: null }).body as T;
    const today = call<TasksResponse>('/tasks', `view=today&date=${localToday()}`);
    expect(today.problems).toEqual([]);
    expect(today.tasks.length).toBeGreaterThanOrEqual(4);
    expect(call<TaskListsResponse>('/tasks/lists').lists.map((l) => l.name)).toEqual(['Inbox', 'Work', 'Home']);
    const dated = call<DatedNotesResponse>('/notes/by-date', `from=${dayOffset(-30)}&to=${dayOffset(30)}`);
    expect(dated.notes.map((n) => n.path)).toEqual(expect.arrayContaining(['Meetings/Design review.md', 'Trip to Lisbon.md']));
    const habits = call<HabitsResponse>('/habits');
    expect(habits.habits).toHaveLength(3);
    expect(habits.daily.length).toBeGreaterThan(10);
    const cards = call<FlashcardNotesResponse>('/flashcards/notes');
    const parsed = cards.notes.flatMap((n) => parseCards(n.path, n.content, { tags: DEFAULT_FLASHCARD_CONFIG.tags, foldersAsDecks: false }));
    expect(parsed.length).toBeGreaterThanOrEqual(10);
  });

  it('opens the spreadsheet, the drawing, the canvas and the Kanban board in their views', () => {
    const sheet = parseSheet(text('Finances/Household budget.sheet'));
    expect(sheet.ok && sheet.repairs).toEqual([]);
    if (sheet.ok) {
      expect(sheet.file.sheets.map((s) => s.name)).toEqual(['Budget', 'Summary']);
      expect(sheet.file.sheets[0].cells.H8).toMatchObject({ f: '=SUM(H2:H7)', c: 17464 });
    }
    const drawing = parseDrawing('excalidraw', text('Drawings/System sketch.excalidraw'));
    expect(drawing.ok && drawing.drawing.scene.elements.length).toBeGreaterThan(10);
    const canvas = parseCanvas(text('Projects/Launch plan.canvas'));
    expect(canvas.nodes.length).toBeGreaterThan(4);
    for (const node of canvas.nodes) if (node.type === 'file') expect(files.map((f) => f.path)).toContain(node.file);
    const board = text('Projects/Roadmap.md');
    expect(isKanbanText(board)).toBe(true);
    const parsed = parseBoard(board);
    expect(parsed.problems).toEqual([]);
    expect(parsed.lanes.map((l) => l.title)).toEqual(['Ideas', 'Next', 'In progress', 'Done']);
  });

  it('adds up the Live Preview table the Welcome note points to', () => {
    const trip = text('Trip to Lisbon.md');
    expect(trip).toContain('| **Total** | =SUM(B2:B6) | =SUM(C2:C6) |');
    expect(trip).toContain('^trip');
  });
});
