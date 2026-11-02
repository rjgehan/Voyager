// What the editor needs from the guest page (DESIGN §6.45): the owner's NoteContext, scoped to a
// share. Links resolve against the share's files and the media its notes embed; a link elsewhere
// says it is not shared; embeds load from the guest raw endpoint; nothing uploads, runs scripts,
// adds block ids to other notes or reads the vault's settings, tags or other notes.
import type { FileEntry } from '../api/types';
import type { VaultTree } from '../api/vaultTree';
import { openContextMenu } from '../components/overlays/openContextMenu';
import type { EmbedRequest, MarkdownBlockRequest, NoteContext } from '../editor/context';
import { resolve } from '../features/links';
import { displayName } from '../features/paths';
import { DEFAULT_SETTINGS } from '../features/settings';
import { renderNote, type RenderContext } from '../render/render';
import { hydrateRich, renderMath } from '../render/rich';
import { toast } from '../state/toasts';
import type { DocumentSession } from '../sync/DocumentSession';
import { isGuestNote } from './guestSync';

export interface GuestEnv {
  /** The share's files and the media its notes embed, as a tree. */
  tree(): VaultTree;
  /** In the share itself (not merely media one of its notes embeds). */
  shared(path: string): boolean;
  rawUrl(entry: Pick<FileEntry, 'path' | 'size' | 'mtime'>, opts?: { download?: boolean }): string;
  /** Shows a shared note on the page. */
  openNote(path: string, subpath: string | null): void;
  /** A shared note's text, for a transclusion. */
  readText(path: string): Promise<string>;
  /** The device's preference for images from other sites. */
  remoteImages(): boolean;
}

export function notShared(name: string): void {
  toast(`“${name}” is not shared with you`);
}

/** Follows a link written in `source`: a shared note opens on the page, a shared file in a new tab. */
export function followGuestLink(env: GuestEnv, target: string, subpath: string | null, source: string): void {
  const tree = env.tree();
  const path = resolve(target, source, tree.links);
  const entry = path ? tree.byPath.get(path) : undefined;
  if (!entry || !env.shared(entry.path)) {
    notShared(displayName(target));
    return;
  }
  if (isGuestNote(entry.path)) env.openNote(entry.path, subpath);
  else window.open(env.rawUrl(entry), '_blank', 'noopener');
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** A file as a chip that opens it from the server (a PDF in the browser's viewer, anything else downloaded). */
function fileChip(env: GuestEnv, entry: FileEntry, download: boolean): HTMLElement {
  const a = element('a', 'guest-embed-chip', entry.name);
  a.href = env.rawUrl(entry, { download });
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function renderContext(env: GuestEnv, sourcePath: string, depth: number): RenderContext {
  return {
    sourcePath,
    resolve: (target) => {
      const tree = env.tree();
      const path = resolve(target, sourcePath, tree.links);
      return path ? (tree.byPath.get(path) ?? null) : null;
    },
    rawUrl: (entry) => env.rawUrl(entry),
    strictLineBreaks: DEFAULT_SETTINGS.editor.strictLineBreaks,
    loadRemoteImages: env.remoteImages(),
    depth,
  };
}

/** Audio, video and file embeds inside rendered Markdown (images are drawn by the renderer itself). */
function hydrateGuestEmbeds(root: Element, env: GuestEnv): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-embed-kind]:not([data-hydrated])')) {
    el.setAttribute('data-hydrated', '');
    const kind = el.dataset.embedKind;
    if (kind === 'image') continue;
    const entry = env.tree().byPath.get(el.dataset.embedPath ?? '');
    if (!entry) continue;
    if (kind === 'audio' || kind === 'video') {
      const media = document.createElement(kind);
      media.controls = true;
      media.preload = 'metadata';
      if (media instanceof HTMLVideoElement) media.setAttribute('playsinline', '');
      media.src = env.rawUrl(entry);
      el.appendChild(media);
    } else {
      el.appendChild(fileChip(env, entry, entry.kind !== 'pdf'));
    }
  }
}

/** Clicks in rendered Markdown: links to shared notes open on the page, others say they are not shared. */
function onRenderedClick(env: GuestEnv, sourcePath: string): (e: MouseEvent) => void {
  return (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const link = target?.closest<HTMLAnchorElement>('a.internal-link');
    if (link) {
      e.preventDefault();
      const href = link.dataset.href ?? '';
      const hash = href.indexOf('#');
      followGuestLink(env, hash < 0 ? href : href.slice(0, hash), hash < 0 ? null : href.slice(hash + 1), sourcePath);
      return;
    }
    if (target?.closest('a.tag')) e.preventDefault();
  };
}

/** A note, an image, audio, video or another file embedded in the note, as Live Preview shows it. */
export function renderGuestEmbed(el: HTMLElement, embed: EmbedRequest, env: GuestEnv, sourcePath: string): () => void {
  const { entry, display, size } = embed;
  el.classList.add('guest-embed');
  if (entry.kind === 'image') {
    const img = element('img', 'guest-embed-image');
    img.src = env.rawUrl(entry);
    img.alt = display ?? entry.basename;
    img.loading = 'lazy';
    if (size) {
      img.width = size.width;
      if (size.height !== null) img.height = size.height;
    }
    el.appendChild(img);
  } else if (entry.kind === 'audio' || entry.kind === 'video') {
    const media = document.createElement(entry.kind);
    media.controls = true;
    media.preload = 'metadata';
    if (media instanceof HTMLVideoElement) {
      media.setAttribute('playsinline', '');
      if (size) media.width = size.width;
    }
    media.src = env.rawUrl(entry);
    el.appendChild(media);
  } else if (entry.kind === 'note') {
    if (!env.shared(entry.path) || !isGuestNote(entry.path) || entry.path === sourcePath) {
      el.appendChild(element('span', 'guest-embed-chip is-not-shared', `${entry.basename}: not shared`));
    } else {
      // One level deep, like the owner's transclusions: the embedded note's own note embeds are links.
      const body = element('div', 'guest-transclusion markdown-rendered');
      const title = element('button', 'guest-transclusion-title', entry.basename);
      title.type = 'button';
      title.addEventListener('click', () => env.openNote(entry.path, embed.subpath));
      el.append(title, body);
      let live = true;
      const onClick = onRenderedClick(env, entry.path);
      body.addEventListener('click', onClick);
      env
        .readText(entry.path)
        .then((text) => {
          if (!live) return;
          body.appendChild(renderNote(text, renderContext(env, entry.path, 1)).fragment);
          for (const box of body.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox')) box.disabled = true;
          hydrateGuestEmbeds(body, env);
          hydrateRich(body);
        })
        .catch(() => {
          if (live) body.textContent = 'This note could not be loaded.';
        });
      return () => {
        live = false;
        body.removeEventListener('click', onClick);
        el.replaceChildren();
      };
    }
  } else {
    el.appendChild(fileChip(env, entry, entry.kind !== 'pdf'));
  }
  return () => el.replaceChildren();
}

/** A block of the note (a callout, a `$$` block, a Mermaid diagram) rendered by the reading pipeline. */
export function renderGuestMarkdown(el: HTMLElement, block: MarkdownBlockRequest, env: GuestEnv, sourcePath: string): () => void {
  el.classList.add('markdown-rendered');
  el.appendChild(renderNote(block.source, renderContext(env, sourcePath, 0)).fragment);
  for (const box of el.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox')) {
    if (!box.closest('[data-embed-root]')) box.disabled = !block.checkboxes;
  }
  hydrateGuestEmbeds(el, env);
  hydrateRich(el);
  const onClick = onRenderedClick(env, sourcePath);
  const onChange = (e: Event) => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || !box.classList.contains('task-list-item-checkbox')) return;
    const line = Number(box.dataset.line);
    const toggled = !box.closest('[data-embed-root]') && Number.isInteger(line) && block.toggleTask(line);
    if (!toggled) box.checked = !box.checked;
  };
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  return () => {
    el.removeEventListener('click', onClick);
    el.removeEventListener('change', onChange);
  };
}

/** The note's properties as their YAML; an edit share can edit it as text. */
export function renderGuestProperties(el: HTMLElement, yaml: string, onEdit: (() => void) | null): () => void {
  const box = element('div', 'guest-properties');
  const pre = element('pre', 'guest-properties-yaml', yaml.trim() === '' ? '(no properties)' : yaml.replace(/\n$/, ''));
  box.appendChild(pre);
  if (onEdit) {
    const edit = element('button', 'button button-small guest-properties-edit', 'Edit properties');
    edit.type = 'button';
    edit.addEventListener('mousedown', (e) => e.preventDefault());
    edit.addEventListener('click', () => onEdit());
    box.appendChild(edit);
  }
  el.appendChild(box);
  return () => el.replaceChildren();
}

/** The NoteContext of a shared note open on the guest page. */
export function guestNoteContext(env: GuestEnv, session: DocumentSession): NoteContext {
  return {
    path: () => session.path,
    tree: () => env.tree(),
    settings: () => DEFAULT_SETTINGS,
    openLink: (target, subpath) => followGuestLink(env, target, subpath, session.path),
    openTag: () => undefined,
    noteMeta: () => Promise.reject(new Error('Not available in a share')),
    vaultTags: () => Promise.resolve([]),
    recentPaths: () => [],
    save: () => void session.flush(),
    insertFiles: () => {
      toast('Files can’t be added to a shared note. Ask its owner to add them.');
    },
    linkTo: (path) => `[[${displayName(path)}]]`,
    showMenu: openContextMenu,
    renderEmbed: (el, embed) => renderGuestEmbed(el, embed, env, session.path),
    renderProperties: (el, yaml, onEdit) => renderGuestProperties(el, yaml, onEdit),
    renderMarkdown: (el, block) => renderGuestMarkdown(el, block, env, session.path),
    renderMath: (el, tex, display) => {
      el.textContent = tex;
      renderMath(el, tex, display).catch((e: unknown) => console.warn('[rich] rendering math failed', e));
    },
  };
}
