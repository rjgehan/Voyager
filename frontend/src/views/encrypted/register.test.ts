import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { httpEndpoints, installEndpoints } from '../../api/endpoints';
import { createMockEndpoints } from '../../api/mock';
import { MockVault } from '../../api/mock/vault';
import { queryClient } from '../../api/queryClient';
import { setActiveEditor } from '../../editor/activeEditor';
import { tableCellHost } from '../../editor/livePreview/table/facets';
import { getCommand } from '../../features/commands';
import { resetKeyringForTests } from '../../features/encryption/keyring';
import { findSections } from '../../features/encryption/meld';
import { useDialogs, type DialogRequest } from '../../state/dialogs';
import { useToasts } from '../../state/toasts';
import { documents } from '../../sync/instance';
import { registerEncryption } from './register';

const PASS = 'correct horse battery staple';
const NOTE = 'Title line\n\n| a | b |\n| --- | --- |\n| secret | y |\n';

beforeAll(() => registerEncryption());

afterEach(() => {
  setActiveEditor(null);
  queryClient.clear();
  resetKeyringForTests();
  useDialogs.setState({ stack: [] });
  useToasts.setState({ toasts: [] });
});

afterAll(() => installEndpoints(httpEndpoints));

let seq = 0;

async function note() {
  const path = `Table ${++seq}.md`;
  const vault = new MockVault(false);
  vault.createFile({ path, content: NOTE }, 'other-device-1');
  installEndpoints(createMockEndpoints(vault, { latency: 0, failures: [] }));
  const session = documents.acquire(path, 'register-test');
  await session.ready;
  return { path, session };
}

/** A table cell's editor of the note: its offsets are the cell's, not the note's. */
function cellEditor(text: string, anchor: number, head: number): EditorView {
  const host = new EditorView({ state: EditorState.create({ doc: NOTE }) });
  return new EditorView({ state: EditorState.create({ doc: text, selection: { anchor, head }, extensions: [tableCellHost.of(host)] }) });
}

/** Answers the dialogs a command opens, as a user would, until it is done. */
async function answerAll(done: Promise<unknown>): Promise<void> {
  let finished = false;
  void done.finally(() => (finished = true));
  while (!finished) {
    const d: DialogRequest | undefined = useDialogs.getState().stack.at(-1);
    if (d?.kind === 'passphrase') {
      await d.submit(PASS, '');
      d.resolve(true);
    } else if (d?.kind === 'secret') {
      d.resolve({ action: 'save', text: 'new secret', hint: '' });
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('encryption commands in a Live Preview table cell', () => {
  it('“Encrypt selection…” never encrypts the note’s text at the cell’s offsets', async () => {
    const { path, session } = await note();
    setActiveEditor(cellEditor('secret', 0, 6));
    await answerAll(Promise.resolve(getCommand('encryption.encryptSelection')!.run({ activePath: path })));
    expect(session.getText()).toBe(NOTE);
    expect(useToasts.getState().toasts.at(-1)?.message).toMatch(/table/);
    documents.release(session, 'register-test');
  });

  it('“Insert encrypted text…” never inserts at the cell’s offset in the note', async () => {
    const { path, session } = await note();
    setActiveEditor(cellEditor('secret', 3, 3));
    await answerAll(Promise.resolve(getCommand('encryption.insertSection')!.run({ activePath: path })));
    expect(findSections(session.getText())).toEqual([]);
    expect(session.getText()).toBe(NOTE);
    documents.release(session, 'register-test');
  });

  it('still encrypts a selection of the note’s own editor', async () => {
    const { path, session } = await note();
    setActiveEditor(new EditorView({ state: EditorState.create({ doc: NOTE, selection: { anchor: 0, head: 5 } }) }));
    await answerAll(Promise.resolve(getCommand('encryption.encryptSelection')!.run({ activePath: path })));
    expect(session.getText().startsWith('%%🔐β ')).toBe(true);
    expect(session.getText().endsWith(' 🔐%% line\n\n| a | b |\n| --- | --- |\n| secret | y |\n')).toBe(true);
    documents.release(session, 'register-test');
  });
});
