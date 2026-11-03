// The decrypted editor races its own encryption and other devices' saves (DESIGN §6.33).
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { httpEndpoints, installEndpoints } from '../../api/endpoints';
import { createMockEndpoints } from '../../api/mock';
import { MockVault } from '../../api/mock/vault';
import { queryClient } from '../../api/queryClient';
import type { FileEntry } from '../../api/types';
import { decryptPayload, deriveKey, encryptText, newWriteKey } from '../../features/encryption/cipher';
import { lock, resetKeyringForTests } from '../../features/encryption/keyring';
import { decodePayload, parseEncryptedFile, serializeEncryptedFile } from '../../features/encryption/meld';
import { documents } from '../../sync/instance';
import EncryptedNoteView from './EncryptedNoteView';

// Made with Node's crypto in the plugin's v2 format (see cipher.test.ts).
const PASS = 'correct horse battery staple';
const V2 = 'AAECAwQFBgcICQoLDA0OD/Dg0MCwoJCAcGBQQDAgEACrsoTj31BFp/0kZclovXUwtfxEYrfkMTA+IESxsfk2+AYujp7x4gue6vCN0sWz';
const PLAIN = 'Bank PIN: 4242 ✓\nsecond line';

let vault: MockVault;
let seq = 0;
let controls: { latency: number; failures: never[] };

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
  resetKeyringForTests();
});

afterAll(() => installEndpoints(httpEndpoints));

const sleep = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

function setup(): FileEntry {
  const path = `Safe/Race ${++seq}.mdenc`;
  vault = new MockVault(false);
  vault.createFile({ path, content: serializeEncryptedFile({ version: '2.0', hint: 'h', encodedData: V2 }) }, 'other-device-1');
  controls = { latency: 0, failures: [] };
  installEndpoints(createMockEndpoints(vault, controls));
  return vault.getTree().files.find((f) => f.path === path)!;
}

function show(entry: FileEntry) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/n/' + entry.path]}>
        <EncryptedNoteView path={entry.path} entry={entry} mode="edit" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function unlocked(entry: FileEntry): Promise<EditorView> {
  const { container } = show(entry);
  await screen.findByText('This note is encrypted');
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: PASS } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await waitFor(() => expect(container.querySelector('.cm-content')).not.toBeNull(), { timeout: 5000 });
  return EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-content')!)!;
}

/** AES-GCM resolves on a later task; widen that window so the races are deterministic. */
function slowEncryption(ms = 200) {
  const subtle = crypto.subtle;
  const real = subtle.encrypt.bind(subtle);
  return vi.spyOn(subtle, 'encrypt').mockImplementation(async (...args: Parameters<SubtleCrypto['encrypt']>) => {
    await new Promise((r) => setTimeout(r, ms));
    return real(...args);
  });
}

const keys = new Map<string, Promise<CryptoKey>>();

async function stored(path: string, passphrase = PASS): Promise<string | null> {
  const p = decodePayload(parseEncryptedFile(vault.readFile(path).content).encodedData, 2);
  const id = passphrase + '/' + p.salt.join(',');
  if (!keys.has(id)) keys.set(id, deriveKey(passphrase, p.salt, 2));
  return decryptPayload(p, await keys.get(id)!);
}

/** Waits for the vault to hold `text`: a save needs the encryption delay, the 1 s autosave and the request. */
async function storedEventually(path: string, text: string): Promise<void> {
  await waitFor(async () => expect(await stored(path)).toBe(text), { timeout: 8000 });
}

/** Waits until an encryption has started (its slowed window is open). */
async function encrypting(spy: ReturnType<typeof slowEncryption>): Promise<void> {
  await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 5000, interval: 5 });
}

/** Waits until the session has settled the pending edit: saved, or a conflict for the user to resolve. */
async function settled(path: string): Promise<void> {
  const session = documents.get(path)!;
  await waitFor(() => expect(['dirty', 'saving']).not.toContain(session.currentStatus), { timeout: 8000 });
}

/** Another device's save of `text`, encrypted with the same passphrase and salt. */
async function theirs(text: string): Promise<string> {
  const salt = decodePayload(V2, 2).salt;
  return serializeEncryptedFile({ version: '2.0', hint: 'h', encodedData: await encryptText(text, { key: await deriveKey(PASS, salt, 2), salt }) });
}

function type(view: EditorView, text: string, at = view.state.doc.length) {
  act(() => view.dispatch({ changes: { from: at, insert: text }, userEvent: 'input' }));
}

describe('EncryptedNoteView races', () => {
  it('encrypts a keystroke typed while the previous edit was being encrypted', async () => {
    const entry = setup();
    const view = await unlocked(entry);
    controls.latency = 500;
    const encrypt = slowEncryption();
    type(view, 'X');
    await encrypting(encrypt); // the 100 ms timer fired: 'X' is being encrypted
    type(view, 'Y');
    await sleep(1600);
    expect(view.state.doc.toString()).toBe(PLAIN + 'XY');
    act(() => lock());
    await storedEventually(entry.path, PLAIN + 'XY');
  }, 30_000);

  it('a save from another device within the encryption delay is a conflict, not a lost keystroke', async () => {
    const entry = setup();
    const view = await unlocked(entry);
    controls.latency = 500;
    const session = documents.get(entry.path)!;
    const phone = await theirs(PLAIN + '\nfrom the phone');
    type(view, 'Z', 0);
    vault.externalWrite(entry.path, phone, 'other-device-2');
    await act(async () => {
      await session.onRemoteChanged({ version: vault.readFile(entry.path).version });
    });
    await waitFor(() => expect(session.currentStatus).toBe('conflict'), { timeout: 8000 });
    expect(view.state.doc.toString()).toBe('Z' + PLAIN);
    // The phone's version stays on the server until the user chooses.
    expect(await stored(entry.path)).toBe(PLAIN + '\nfrom the phone');
  }, 30_000);

  it('a save from another device during an encryption never leaves the editor and the file apart', async () => {
    const entry = setup();
    const view = await unlocked(entry);
    controls.latency = 500;
    const session = documents.get(entry.path)!;
    const phone = await theirs(PLAIN + '\nfrom the phone');
    const encrypt = slowEncryption();
    type(view, 'Z', 0);
    await encrypting(encrypt); // 'Z' is being encrypted
    vault.externalWrite(entry.path, phone, 'other-device-2');
    await act(async () => {
      await session.onRemoteChanged({ version: vault.readFile(entry.path).version });
    });
    await settled(entry.path);
    if (session.currentStatus === 'conflict') {
      expect(view.state.doc.toString()).toBe('Z' + PLAIN);
      expect(await stored(entry.path)).toBe(PLAIN + '\nfrom the phone');
    } else {
      expect(await stored(entry.path)).toBe(view.state.doc.toString());
    }
  }, 30_000);

  it('a pending edit never undoes another device’s new passphrase', async () => {
    const entry = setup();
    const view = await unlocked(entry);
    controls.latency = 500;
    const session = documents.get(entry.path)!;
    const NEW = 'a brand new passphrase here';
    const phone = serializeEncryptedFile({ version: '2.0', hint: 'new hint', encodedData: await encryptText(PLAIN + '\nphone text', await newWriteKey(NEW)) });
    type(view, 'Z', 0);
    vault.externalWrite(entry.path, phone, 'other-device-2');
    await act(async () => {
      await session.onRemoteChanged({ version: vault.readFile(entry.path).version });
    });
    // Only once the edit is settled (saved, or a conflict) does "nothing overwrote it" mean anything.
    await settled(entry.path);
    expect(await stored(entry.path, NEW)).toBe(PLAIN + '\nphone text');
  }, 30_000);

  it('unlocking while another device saves shows (and keeps) the text the session holds', async () => {
    const entry = setup();
    const { container } = show(entry);
    await screen.findByText('This note is encrypted');
    const session = documents.get(entry.path)!;
    const phone = await theirs(PLAIN + '\nfrom the phone');
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: PASS } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    // The key derivation runs; the phone saves meanwhile.
    vault.externalWrite(entry.path, phone, 'other-device-2');
    await act(async () => {
      await session.onRemoteChanged({ version: vault.readFile(entry.path).version });
    });
    await waitFor(() => expect(container.querySelector('.cm-content')).not.toBeNull(), { timeout: 5000 });
    await sleep(300);
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-content')!)!;
    controls.latency = 500;
    expect(view.state.doc.toString()).toBe(PLAIN + '\nfrom the phone');
    type(view, '!', 0);
    await storedEventually(entry.path, '!' + PLAIN + '\nfrom the phone');
  }, 30_000);
});
