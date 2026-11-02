import { act, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockVault } from '../../api/mock/vault';
import { useToasts } from '../../state/toasts';
import { DocumentSession } from '../../sync/DocumentSession';
import { fakeApi, sessionDeps } from '../../test/fakes';
import { CardEditor } from './CardEditor';
import { CanvasController } from './controller';
import { OBSIDIAN_SAMPLE } from './fixtures.test-data';
import { parseCanvas, serializeCanvas } from './format';
import { nodeText } from './model';
import { updateNode } from './ops';

const PATH = 'Board.canvas';
const TEXT = '59e896bc8da20699';

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ toasts: [] });
});

afterEach(() => vi.useRealTimers());

describe('CardEditor and another device', () => {
  it('shows another device’s change of the card being edited, and the next keystroke keeps it', async () => {
    const vault = new MockVault(false);
    vault.createFile({ path: PATH, content: OBSIDIAN_SAMPLE }, 'other-device-1');
    const session = new DocumentSession(PATH, sessionDeps(fakeApi(vault).api));
    await session.ready;
    const controller = new CanvasController();
    controller.bind(session);
    controller.startEditing(TEXT);
    const card = () => nodeText(controller.getState().doc!.nodes.find((n) => n.id === TEXT)!);
    const props = (text: string) => ({
      text,
      canvasPath: PATH,
      onChange: (t: string) => controller.setNodeText(TEXT, t),
      onDone: () => controller.stopEditing(),
      onSave: () => controller.save(),
      onBlur: () => controller.writeNow(),
    });
    const { container, rerender } = render(<CardEditor {...props(card())} />);
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(session.getSnapshot().status).toBe('clean');

    const theirs = serializeCanvas(updateNode(parseCanvas(vault.readFile(PATH).content), TEXT, { text: 'From the phone' }));
    vault.externalWrite(PATH, theirs);
    await session.onRemoteChanged({ version: vault.readFile(PATH).version });
    expect(card()).toBe('From the phone');
    rerender(<CardEditor {...props(card())} />); // as NodeView re-renders it
    expect(view.state.doc.toString()).toBe('From the phone');

    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '?' } }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(card()).toBe('From the phone?');
    expect(nodeText(parseCanvas(vault.readFile(PATH).content).nodes.find((n) => n.id === TEXT)!)).toBe('From the phone?');
  });

  it('keeps what is typed when the host re-renders with the text it started from (Kanban)', () => {
    const typed: string[] = [];
    const props = { canvasPath: PATH, onChange: (t: string) => typed.push(t), onDone: () => undefined, onSave: () => undefined, onBlur: () => undefined };
    const { container, rerender } = render(<CardEditor text="Card" {...props} />);
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
    act(() => view.dispatch({ changes: { from: 4, insert: ' edited' } }));
    rerender(<CardEditor text="Card" {...props} />);
    expect(view.state.doc.toString()).toBe('Card edited');
    expect(typed).toEqual(['Card edited']);
  });
});
