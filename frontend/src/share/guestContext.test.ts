import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../api/types';
import { buildVaultTree } from '../api/vaultTree';
import { useToasts } from '../state/toasts';
import type { DocumentSession } from '../sync/DocumentSession';
import { followGuestLink, guestNoteContext, renderGuestEmbed, renderGuestProperties, type GuestEnv } from './guestContext';

function entry(path: string, kind: FileEntry['kind']): FileEntry {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return { path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : '', kind, size: 10, mtime: '2026-11-02T10:00:00.000Z', version: kind === 'note' ? 'v' : null, aliases: [] };
}

// A folder share of Family/Recipes, whose notes embed a photo kept in Attachments.
const tree = buildVaultTree({
  eventId: 'b.1',
  folders: [{ path: 'Family/Recipes', name: 'Recipes' }],
  files: [entry('Family/Recipes/Pie.md', 'note'), entry('Family/Recipes/pie.png', 'image'), entry('Family/Recipes/menu.pdf', 'pdf'), entry('Family/Recipes/list.xlsx', 'other'), entry('Attachments/photo.png', 'image')],
});

function env(overrides: Partial<GuestEnv> = {}): GuestEnv {
  return {
    tree: () => tree,
    shared: (p) => p.startsWith('Family/Recipes/'),
    rawUrl: (e, opts) => `/raw/${e.path}${opts?.download ? '?download' : ''}`,
    openNote: vi.fn(),
    readText: async () => '# Pie\n',
    remoteImages: () => true,
    ...overrides,
  };
}

function lastToast(): string | undefined {
  const toasts = useToasts.getState().toasts;
  return toasts[toasts.length - 1]?.message;
}

afterEach(() => {
  useToasts.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('links in a shared note', () => {
  it('open a shared note on the page', () => {
    const e = env();
    followGuestLink(e, 'Pie', 'Crust', 'Family/Recipes/Soup.md');
    expect(e.openNote).toHaveBeenCalledWith('Family/Recipes/Pie.md', 'Crust');
  });

  it('say that anything else is not shared, whether it exists or not', () => {
    const e = env();
    followGuestLink(e, 'Diary', null, 'Family/Recipes/Pie.md');
    expect(lastToast()).toBe('“Diary” is not shared with you');
    // Embedded media is readable, but it is not part of the share to open from a link.
    followGuestLink(e, 'photo.png', null, 'Family/Recipes/Pie.md');
    expect(lastToast()).toBe('“photo.png” is not shared with you');
    expect(e.openNote).not.toHaveBeenCalled();
  });

  it('open a shared file from the server in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    followGuestLink(env(), 'menu.pdf', null, 'Family/Recipes/Pie.md');
    expect(open).toHaveBeenCalledWith('/raw/Family/Recipes/menu.pdf', '_blank', 'noopener');
  });
});

describe('embeds in a shared note', () => {
  it('show images, audio and video from the guest raw endpoint', () => {
    const el = document.createElement('div');
    const remove = renderGuestEmbed(el, { entry: entry('Attachments/photo.png', 'image'), subpath: null, display: 'A photo', size: { width: 240, height: null } }, env(), 'Family/Recipes/Pie.md');
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/raw/Attachments/photo.png');
    expect(img.alt).toBe('A photo');
    expect(img.width).toBe(240);
    remove();
    expect(el.childElementCount).toBe(0);
    renderGuestEmbed(el, { entry: entry('Family/Recipes/song.mp3', 'audio'), subpath: null, display: null, size: null }, env(), 'Family/Recipes/Pie.md');
    expect(el.querySelector('audio')?.getAttribute('src')).toBe('/raw/Family/Recipes/song.mp3');
  });

  it('link a PDF to the browser’s viewer and download other files', () => {
    const pdf = document.createElement('div');
    renderGuestEmbed(pdf, { entry: entry('Family/Recipes/menu.pdf', 'pdf'), subpath: null, display: null, size: null }, env(), 'Family/Recipes/Pie.md');
    expect(pdf.querySelector('a')?.getAttribute('href')).toBe('/raw/Family/Recipes/menu.pdf');
    const other = document.createElement('div');
    renderGuestEmbed(other, { entry: entry('Family/Recipes/list.xlsx', 'other'), subpath: null, display: null, size: null }, env(), 'Family/Recipes/Pie.md');
    expect(other.querySelector('a')?.getAttribute('href')).toBe('/raw/Family/Recipes/list.xlsx?download');
  });

  it('transclude a shared note and say so for one that is not shared', async () => {
    const shared = document.createElement('div');
    renderGuestEmbed(shared, { entry: entry('Family/Recipes/Pie.md', 'note'), subpath: null, display: null, size: null }, env(), 'Family/Recipes/Soup.md');
    await vi.waitFor(() => expect(shared.querySelector('.guest-transclusion h1')?.textContent).toBe('Pie'));
    const outside = document.createElement('div');
    renderGuestEmbed(outside, { entry: entry('Private/Diary.md', 'note'), subpath: null, display: null, size: null }, env(), 'Family/Recipes/Soup.md');
    expect(outside.textContent).toBe('Diary: not shared');
  });

  it('show properties as their YAML, editable as text only when the share is', () => {
    const el = document.createElement('div');
    const onEdit = vi.fn();
    renderGuestProperties(el, 'tags: [food]\n', onEdit);
    expect(el.querySelector('pre')?.textContent).toBe('tags: [food]');
    el.querySelector('button')!.click();
    expect(onEdit).toHaveBeenCalled();
    const readOnly = document.createElement('div');
    renderGuestProperties(readOnly, 'tags: [food]\n', null);
    expect(readOnly.querySelector('button')).toBeNull();
  });
});

describe('the guest note context', () => {
  it('reaches nothing of the vault beyond the share', async () => {
    const session = { path: 'Family/Recipes/Pie.md', flush: vi.fn(async () => undefined) } as unknown as DocumentSession;
    const ctx = guestNoteContext(env(), session);
    expect(ctx.path()).toBe('Family/Recipes/Pie.md');
    expect(ctx.tree().byPath.has('Private/Diary.md')).toBe(false);
    await expect(ctx.noteMeta('Private/Diary.md')).rejects.toThrow();
    expect(await ctx.vaultTags()).toEqual([]);
    expect(ctx.recentPaths()).toEqual([]);
    expect(ctx.blocks).toBeUndefined();
    expect(ctx.runScript).toBeUndefined();
    ctx.insertFiles([new File(['x'], 'x.png')], { from: 0, to: 0 }, true);
    expect(lastToast()).toMatch(/can’t be added to a shared note/);
    ctx.save();
    expect(session.flush).toHaveBeenCalled();
  });
});
