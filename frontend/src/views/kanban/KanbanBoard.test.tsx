import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockVault } from '../../api/mock/vault';
import { DocumentSession } from '../../sync/DocumentSession';
import { fakeApi, sessionDeps } from '../../test/fakes';
import KanbanBoard from './KanbanBoard';

const SETTINGS = '%% kanban:settings\n```\n{"kanban-plugin":"basic", "lane-width": 270}\n```\n%%\n';
const BOARD = ['---', '', 'kanban-plugin: basic', '', '---', '', '## To do', '', '- [ ] Call [[Bob]] @{2020-01-02}', '- [ ] Second', '', '', '## Done', '', '**Complete**', '', '', '', '', SETTINGS].join('\n');

async function setup(text = BOARD, onShowMarkdown = () => {}) {
  const vault = new MockVault(false);
  vault.createFile({ path: 'Board.md', content: text }, 'o');
  vault.createFile({ path: 'Bob.md', content: 'Bob' }, 'o');
  const fake = fakeApi(vault);
  const session = new DocumentSession('Board.md', sessionDeps(fake.api));
  await session.ready;
  const qc = new QueryClient();
  qc.setQueryData(['tree'], vault.getTree());
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <KanbanBoard session={session} readOnly={false} onShowMarkdown={onShowMarkdown} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(() => vi.advanceTimersByTimeAsync(50));
  return { session, view };
}

const lane = (name: string) => screen.getByRole('region', { name: 'Board.md board' }).querySelector<HTMLElement>(`[aria-label="${name}"]`)!;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('KanbanBoard', () => {
  it('shows the lanes and cards, with links, dates and the complete lane', async () => {
    await setup();
    const todo = lane('To do');
    expect(within(todo).getAllByRole('listitem')).toHaveLength(2);
    const link = todo.querySelector<HTMLAnchorElement>('a.internal-link');
    expect(link?.textContent).toBe('Bob');
    expect(within(todo).getByText('2020-01-02').closest('.kanban-chip')).toHaveClass('is-overdue');
    expect(within(lane('Done')).getByText('No cards')).toBeInTheDocument();
    expect(screen.getByTitle('Cards moved here are marked as done')).toBeInTheDocument();
  });

  it('moves a card with the keyboard into the complete lane, checking it, and keeps the settings block', async () => {
    const { session } = await setup();
    const card = lane('To do').querySelectorAll<HTMLElement>('[data-board-card]')[1];
    act(() => {
      card.focus();
      fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true });
    });
    const text = session.getText();
    expect(text).toContain('## Done\n\n**Complete**\n- [x] Second\n');
    expect(text).toContain('## To do\n\n- [ ] Call [[Bob]] @{2020-01-02}\n\n\n## Done');
    expect(text.endsWith('\n\n' + SETTINGS)).toBe(true);
  });

  it('archives a card from its menu and lists it in the archive', async () => {
    const { session } = await setup();
    const card = lane('To do').querySelectorAll<HTMLElement>('[data-board-card]')[1];
    fireEvent.click(within(card).getByRole('button', { name: 'Card actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(session.getText()).toContain('***\n\n## Archive\n\n- [ ] Second\n\n' + SETTINGS);
    fireEvent.click(screen.getByRole('button', { name: /Archive \(1\)/ }));
    const archive = screen.getByRole('region', { name: 'Archived cards' });
    expect(within(archive).getByText('Second')).toBeInTheDocument();
    fireEvent.click(within(archive).getByRole('button', { name: 'Restore to the first lane' }));
    expect(session.getText()).not.toContain('## Archive');
    expect(within(lane('To do')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('a card’s menu acts on that card even when the board changed while the menu was open', async () => {
    const { session } = await setup();
    const card = lane('To do').querySelectorAll<HTMLElement>('[data-board-card]')[1];
    fireEvent.click(within(card).getByRole('button', { name: 'Card actions' }));
    // Another device (or another pane) adds a card at the top of the lane meanwhile.
    act(() => session.applyEdit({ from: session.getText().indexOf('- [ ] Call'), insert: '- [ ] New on top\n' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const text = session.getText();
    expect(text).toContain('- [ ] New on top\n- [ ] Call [[Bob]] @{2020-01-02}\n');
    expect(text).not.toContain('Second');
  });

  it('a lane’s menu acts on that lane even when lanes moved while it was open', async () => {
    const { session } = await setup();
    fireEvent.click(within(lane('Done')).getByRole('button', { name: 'More for lane Done' }));
    act(() => session.applyEdit({ from: session.getText().indexOf('## To do'), insert: '## Ideas\n\n- [ ] Maybe\n\n\n' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete lane…' }));
    const text = session.getText();
    expect(text).not.toContain('## Done');
    expect(text).toContain('## To do');
    expect(text).toContain('## Ideas');
  });

  it('moves a lane right from its menu', async () => {
    const { session } = await setup();
    fireEvent.click(within(lane('To do')).getByRole('button', { name: 'More for lane To do' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move lane right' }));
    expect(session.getText().indexOf('## Done')).toBeLessThan(session.getText().indexOf('## To do'));
  });

  it('opens an editor on a card when it is clicked', async () => {
    await setup();
    const card = lane('To do').querySelectorAll<HTMLElement>('[data-board-card]')[1];
    fireEvent.click(within(card).getByText('Second'));
    expect(card.querySelector('.kanban-card-editor .cm-editor')).not.toBeNull();
  });

  it('shows a board with lines it cannot hold without editing, and offers the Markdown', async () => {
    const onShowMarkdown = vi.fn();
    const { session } = await setup(BOARD.replace('- [ ] Second', '- [ ] Second\n\nA stray paragraph'), onShowMarkdown);
    expect(screen.getByRole('note')).toHaveTextContent('Line 12 is not part of a card or a lane');
    expect(screen.queryByRole('button', { name: /Add card/ })).toBeNull();
    const before = session.getText();
    const card = lane('To do').querySelectorAll<HTMLElement>('[data-board-card]')[1];
    act(() => {
      card.focus();
      fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true });
    });
    expect(session.getText()).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: /Open as Markdown/ }));
    expect(onShowMarkdown).toHaveBeenCalled();
  });
});

// An open card edit is kept when another device changes the board under it (DESIGN §6.8.4).
describe('KanbanBoard: a card edit while the board changes', () => {
  const editorIn = (el: Element) => EditorView.findFromDOM(el.querySelector<HTMLElement>('.kanban-card-editor .cm-editor')!)!;
  const second = () => [...lane('To do').querySelectorAll<HTMLElement>('[data-board-card]')].find((c) => c.textContent?.includes('Second'))!;

  async function typing(session: DocumentSession) {
    fireEvent.click(within(second()).getByText('Second'));
    const view = editorIn(second());
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' and brushes' }, userEvent: 'input.type' }));
    expect(session.getText()).not.toContain('and brushes');
  }

  const replaceLine = (session: DocumentSession, line: string, by: string) => {
    const from = session.getText().indexOf(line);
    act(() => session.applyEdit({ from, to: from + line.length, insert: by }));
  };

  it('keeps the typed text as a new card when the card was changed elsewhere', async () => {
    const { session } = await setup();
    await typing(session);
    replaceLine(session, '- [ ] Second', '- [ ] Second (phone)');
    await act(() => vi.advanceTimersByTimeAsync(50));
    // Opening another card afterwards does not drop it either.
    fireEvent.click(within(lane('To do')).getByText('Call'));
    fireEvent.keyDown(lane('To do').querySelector('.kanban-card-editor .cm-content')!, { key: 'Escape' });
    await act(() => vi.advanceTimersByTimeAsync(50));
    const text = session.getText();
    expect(text).toContain('- [ ] Second (phone)\n');
    expect(text).toContain('- [ ] Second and brushes\n');
  });

  it('keeps the typed text as a new card when the card was deleted elsewhere', async () => {
    const { session } = await setup();
    await typing(session);
    replaceLine(session, '- [ ] Second\n', '');
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(session.getText()).toContain('## To do\n\n- [ ] Call [[Bob]] @{2020-01-02}\n- [ ] Second and brushes\n');
  });

  it('a card moved to another lane elsewhere keeps the text being typed in its editor', async () => {
    const { session } = await setup();
    await typing(session);
    // One save from the other device: the line leaves To do and arrives in Done.
    const text = session.getText();
    const from = text.indexOf('- [ ] Second\n');
    const to = text.indexOf('**Complete**\n') + '**Complete**\n'.length;
    act(() => session.applyEdit([{ from, to: from + '- [ ] Second\n'.length, insert: '' }, { from: to, insert: '- [x] Second\n' }]));
    await act(() => vi.advanceTimersByTimeAsync(50));
    const card = lane('Done').querySelector<HTMLElement>('[data-board-card]')!;
    const view = editorIn(card);
    expect(view.state.doc.toString()).toBe('Second and brushes');
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '!' }, userEvent: 'input.type' }));
    fireEvent.keyDown(card.querySelector('.cm-content')!, { key: 'Escape' });
    expect(session.getText()).toContain('**Complete**\n- [x] Second and brushes!\n');
  });
});

// iOS may discard a Home-Screen app it hid without a blur: an open card editor commits on hide.
describe('KanbanBoard: hiding the page with a card editor open', () => {
  const editorIn = (el: Element) => EditorView.findFromDOM(el.querySelector<HTMLElement>('.kanban-card-editor .cm-editor')!)!;
  const hide = () =>
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('puts a card being added into the note and keeps the add editor open', async () => {
    const { session } = await setup();
    fireEvent.click(within(lane('To do')).getByRole('button', { name: /^Add card$/ }));
    const view = editorIn(lane('To do'));
    act(() => view.dispatch({ changes: { from: 0, insert: 'buy milk' }, userEvent: 'input.type' }));
    const flush = vi.spyOn(session, 'flush');
    hide();
    expect(session.getText()).toContain('- [ ] buy milk\n');
    expect(flush).toHaveBeenCalled();
    expect(lane('To do').querySelector('.kanban-add-editor .kanban-card-editor')).not.toBeNull();
  });

  it('puts a card being edited into the note and keeps its editor open with the text', async () => {
    const { session } = await setup();
    const second = () => [...lane('To do').querySelectorAll<HTMLElement>('[data-board-card]')].find((c) => c.textContent?.includes('Second'))!;
    fireEvent.click(within(second()).getByText('Second'));
    const view = editorIn(second());
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' and brushes' }, userEvent: 'input.type' }));
    hide();
    expect(session.getText()).toContain('- [ ] Second and brushes\n');
    await act(() => vi.advanceTimersByTimeAsync(50));
    const card = lane('To do').querySelector<HTMLElement>('.kanban-edit')!;
    expect(editorIn(card.parentElement!).state.doc.toString()).toBe('Second and brushes');
    // Ending the edit later adds nothing more.
    act(() => editorIn(card.parentElement!).dispatch({ changes: { from: editorIn(card.parentElement!).state.doc.length, insert: '!' }, userEvent: 'input.type' }));
    fireEvent.keyDown(lane('To do').querySelector('.kanban-card-editor .cm-content')!, { key: 'Escape' });
    const text = session.getText();
    expect(text).toContain('- [ ] Second and brushes!\n');
    expect(text).not.toContain('- [ ] Second and brushes\n');
    expect(text.match(/Second/g)).toHaveLength(1);
  });
});
