// Commands that create files wait for the vault's settings instead of using the defaults while
// /api/settings has not answered yet (a slow start over the tailnet, the desktop tray's "Open
// today's note" delivered as the page boots, a page opened on /search or a sheet).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransientError } from '../api/client';
import { api } from '../api/endpoints';
import { MockVault } from '../api/mock/vault';
import { queryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import type { CreateFileRequest, Settings, SettingsResponse } from '../api/types';
import { registerBuiltins } from '../extensions/builtins';
import { usePendingNote } from '../state/pendingNote';
import { runCommand } from './commands';
import { openDailyNote } from './daily';
import { dayjs } from './dates';
import { openLink, setNavigator } from './navigation';
import { DEFAULT_SETTINGS } from './settings';

const vaultSettings: Settings = {
  ...DEFAULT_SETTINGS,
  dailyNotes: { format: 'DD-MM-YYYY', folder: 'Journal', template: 'Templates/Daily.md', openOnStartup: false },
  files: { ...DEFAULT_SETTINGS.files, newNoteLocation: 'folder', newNoteFolder: 'Inbox' },
  templates: { ...DEFAULT_SETTINGS.templates, folderTemplates: [{ folder: 'Inbox', template: 'Templates/Inbox.md' }] },
};
const response: SettingsResponse = { settings: vaultSettings, version: 'v1', readOnly: false };

let vault: MockVault;
let routes: string[];

beforeEach(() => {
  registerBuiltins();
  vault = new MockVault(false);
  vault.createFile({ path: 'Templates/Daily.md', content: '# Day {{title}}\n' }, 'o');
  vault.createFile({ path: 'Templates/Inbox.md', content: 'Inbox: {{title}}\n' }, 'o');
  queryClient.setQueryData(queryKeys.tree(), vault.getTree());
  vi.spyOn(api, 'readFile').mockImplementation(async (path: string) => structuredClone(vault.readFile(path)));
  routes = [];
  setNavigator((to) => routes.push(to));
});

afterEach(() => {
  queryClient.clear();
  usePendingNote.setState({ pending: null, handoff: null });
});

function serverHasSettings() {
  return vi.spyOn(api, 'getSettings').mockResolvedValue(structuredClone(response));
}

function creates() {
  return vi.spyOn(api, 'createFile').mockImplementation(async (req: CreateFileRequest) => structuredClone(vault.createFile(req, 'me')));
}

describe('before /api/settings has answered', () => {
  it('Today opens the existing daily note of the vault’s own folder and format', async () => {
    vault.createFile({ path: 'Journal/02-11-2026.md', content: 'today' }, 'o');
    queryClient.setQueryData(queryKeys.tree(), vault.getTree());
    serverHasSettings();
    const create = creates();
    await expect(openDailyNote(dayjs('2026-11-02'))).resolves.toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(routes.at(-1)).toBe('/n/Journal/02-11-2026.md');
  });

  it('Today creates a missing daily note where the settings say, from its template', async () => {
    serverHasSettings();
    const create = creates();
    await expect(openDailyNote(dayjs('2026-11-02'))).resolves.toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ path: 'Journal/02-11-2026.md', content: '# Day 02-11-2026\n' });
  });

  it('New note goes to the configured folder, with its folder template', async () => {
    serverHasSettings();
    const create = creates();
    runCommand('file.newNote', { activePath: null });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ path: 'Inbox/Untitled.md', content: 'Inbox: Untitled\n' });
  });

  it('a link to a missing note creates it where new notes go, with the folder template', async () => {
    serverHasSettings();
    const create = creates();
    await openLink('Missing', null, 'Some/Note.md');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ path: 'Inbox/Missing.md', content: 'Inbox: Missing\n' });
  });

  it('when the settings cannot be loaded (offline), nothing is created at the default places', async () => {
    vi.spyOn(api, 'getSettings').mockRejectedValue(new TransientError('Failed to fetch'));
    const create = creates();
    await expect(openDailyNote(dayjs('2026-11-02'))).resolves.toBe(false);
    runCommand('file.newNote', { activePath: null });
    await openLink('Missing', null, 'Some/Note.md');
    await new Promise((r) => setTimeout(r, 20));
    expect(create).not.toHaveBeenCalled();
    expect(usePendingNote.getState().pending).toBeNull();
  });
});
