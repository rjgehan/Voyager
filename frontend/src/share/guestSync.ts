// One share on the guest page (DESIGN §6.48): the share as the server shows it, and the owner's
// sync machinery pointed at the guest endpoints: a DocumentRegistry (autosave, version tokens,
// conflicts, drafts), an EventStream on the share's own stream, and applyEvent on a QueryClient
// of the page's own whose tree is the share's files and the media its notes embed.
import type { QueryClient } from '@tanstack/react-query';
import { ApiError, isProblem, isTransient } from '../api/client';
import { EventStream } from '../api/events';
import { createQueryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import type { FileEvent, GuestShareResponse, TreeResponse } from '../api/types';
import { buildVaultTree, EMPTY_TREE, type VaultTree } from '../api/vaultTree';
import { isPhoneLayout } from '../features/platform';
import { DEFAULT_SETTINGS } from '../features/settings';
import { clientId } from '../state/clientId';
import { toast } from '../state/toasts';
import { vaultKey } from '../state/vault';
import { applyEvent, type SyncTarget } from '../sync/applyEvents';
import { DocumentRegistry } from '../sync/documents';
import { IdbDraftStore, type DraftRecord, type DraftStore } from '../sync/drafts';
import { MoveMap } from '../sync/moves';
import { provideSessionLookup } from '../sync/sessionLookup';
import { guestApi, type GuestApi } from './guestApi';

export type GuestState =
  | { status: 'loading' }
  | { status: 'ready'; share: GuestShareResponse }
  /** 404 share-not-found: revoked, expired, never existed, or not for this login. */
  | { status: 'ended' }
  /** 429 too-many-attempts. */
  | { status: 'limited'; retryAfterS: number | null }
  | { status: 'error'; message: string };

/** The guest stream's own event: something moved in or out of the share; refetch it. */
export const SHARE_CHANGED = 'share.changed';

/** Drafts kept in memory, for browsers without IndexedDB (old private modes). */
class MemoryDraftStore implements DraftStore {
  private drafts = new Map<string, DraftRecord>();
  async put(d: DraftRecord) {
    this.drafts.set(`${d.path}\n${d.clientId}`, d);
  }
  async remove(path: string, id: string) {
    this.drafts.delete(`${path}\n${id}`);
  }
  async listForPath(path: string) {
    return [...this.drafts.values()].filter((d) => d.path === path);
  }
  async listAll() {
    return [...this.drafts.values()];
  }
  async rekey() {}
  async discard() {
    return 0;
  }
  async takeDiscarded() {
    return null;
  }
  async listDiscarded() {
    return [];
  }
  async prune() {}
}

/** The share's notes are Markdown notes (not drawings), as the server edits them. */
export function isGuestNote(path: string): boolean {
  return /\.md$/i.test(path) && !/\.excalidraw\.md$/i.test(path);
}

/** As the server scopes a share (DESIGN §5.40): its note, or everything strictly under its folder. */
export function inShare(share: Pick<GuestShareResponse, 'kind' | 'path'>, path: string): boolean {
  return share.kind === 'note' ? path === share.path : path.startsWith(share.path + '/');
}

export class GuestSync {
  readonly api: GuestApi;
  readonly qc: QueryClient = createQueryClient();
  readonly moves = new MoveMap();
  private registryInstance: DocumentRegistry | null = null;
  private drafts: DraftStore = new MemoryDraftStore();
  private stream: EventStream | null = null;
  private state: GuestState = { status: 'loading' };
  private readonly listeners = new Set<() => void>();
  private caughtUp = false;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private stopLifecycle: (() => void) | null = null;
  private stopped = false;
  private generation = 0;
  /** The page follows a note that moved while it was open. */
  private onSessionMoved: (from: string, to: string) => void = () => {};

  constructor(key: string) {
    this.api = guestApi(key);
  }

  setSessionMoved(fn: (from: string, to: string) => void): void {
    this.onSessionMoved = fn;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): GuestState => this.state;

  private setState(state: GuestState): void {
    this.state = state;
    for (const fn of this.listeners) fn();
  }

  /** The files the editor resolves links and embeds against: the share's and its embedded media. */
  tree(): VaultTree {
    return buildVaultTree(this.qc.getQueryData<TreeResponse>(queryKeys.tree()) ?? EMPTY_TREE);
  }

  get registry(): DocumentRegistry {
    if (!this.registryInstance) throw new Error('The share is not loaded yet');
    return this.registryInstance;
  }

  /** Loads the share, then opens its event stream. */
  async start(): Promise<void> {
    this.stopped = false;
    const generation = ++this.generation;
    let eventId: string;
    try {
      eventId = await this.refetch();
    } catch {
      return;
    }
    // Stopped meanwhile, or started again (React runs effects twice in development).
    if (this.stopped || generation !== this.generation) return;
    this.stopLifecycle ??= this.registry.installLifecycle(() => !isPhoneLayout());
    this.stream = new EventStream({
      clientId,
      open: (id, last) => this.api.openEvents(id, last),
      apply: (name, data) => this.apply(name, data),
      refetchTree: () => this.refetch(),
      invalidateAll: () => undefined,
      revalidateDocuments: () => this.registryInstance?.revalidateAll(),
      retryQueued: () => this.registryInstance?.retryAll(),
      onBuild: () => undefined,
      onHealth: (health) => {
        // A stream that keeps failing may be a share that ended: the share itself says.
        if (health === 'reconnecting') this.scheduleCheck();
      },
      onCaughtUp: (caughtUp) => {
        this.caughtUp = caughtUp;
      },
      extensionNames: () => [SHARE_CHANGED],
      onExtensionsChanged: () => () => undefined,
    });
    this.stream.start(eventId);
  }

  stop(): void {
    this.stopped = true;
    this.stream?.stop();
    this.stream = null;
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.refetchTimer = null;
    this.checkTimer = null;
    this.stopLifecycle?.();
    this.stopLifecycle = null;
  }

  /** Fetches the share again (start, resync, `share.changed`) and returns its `eventId`. */
  async refetch(): Promise<string> {
    let share: GuestShareResponse;
    try {
      share = await this.api.share();
    } catch (e) {
      this.failed(e);
      throw e;
    }
    if (this.stopped) return share.eventId;
    this.ensureRegistry(share.id);
    const tree: TreeResponse = { eventId: share.eventId, folders: share.folders, files: [...share.files, ...share.embedded] };
    this.qc.setQueryData(queryKeys.tree(), tree);
    this.setState({ status: 'ready', share });
    return share.eventId;
  }

  /** A refetch soon, coalescing bursts (a note saved several times embeds new media once). */
  scheduleRefetch(delayMs = 400): void {
    if (this.refetchTimer) return;
    this.refetchTimer = setTimeout(() => {
      this.refetchTimer = null;
      void this.refetch().catch(() => undefined);
    }, delayMs);
  }

  private scheduleCheck(): void {
    if (this.checkTimer || this.stopped) return;
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      void this.refetch().catch(() => undefined);
    }, 2000);
  }

  private failed(e: unknown): void {
    if (isProblem(e, 'share-not-found')) {
      this.setState({ status: 'ended' });
      this.stream?.stop();
    } else if (isProblem(e, 'too-many-attempts')) {
      const retry = (e as ApiError).problem.retryAfter;
      this.setState({ status: 'limited', retryAfterS: typeof retry === 'number' ? retry : null });
      this.stream?.stop();
    } else if (this.state.status !== 'ready') {
      this.setState({ status: 'error', message: isTransient(e) ? 'Can’t reach Voyager. Is Tailscale connected?' : e instanceof Error ? e.message : String(e) });
    }
  }

  private ensureRegistry(shareId: string): void {
    if (this.registryInstance) return;
    if (typeof indexedDB !== 'undefined') this.drafts = new IdbDraftStore(indexedDB, vaultKey('notesapp-share-' + shareId));
    const registry = new DocumentRegistry({
      api: { readFile: (path) => this.api.readFile(path), saveFile: (path, req, opts) => this.api.saveFile(path, req, opts) },
      drafts: this.drafts,
      moves: this.moves,
      clientId,
      queryClient: this.qc,
      tabs: null,
      treeEntry: (path) => this.tree().byPath.get(path),
      notify: (n) => toast(n.message, { action: n.action }),
      onDraftWrite: () => undefined,
      onSummary: () => undefined,
      onSessionMoved: (from, to) => this.onSessionMoved(from, to),
      caughtUp: () => this.caughtUp,
    });
    this.registryInstance = registry;
    provideSessionLookup((path) => registry.get(path));
    void this.drafts.prune().catch(() => undefined);
  }

  private syncTarget(): SyncTarget {
    return {
      qc: this.qc,
      documents: this.registry,
      moves: this.moves,
      drafts: this.drafts,
      settings: () => DEFAULT_SETTINGS,
      onEntryMoved: () => this.scheduleRefetch(),
      onDraftFailure: () => undefined,
    };
  }

  private apply(name: string, data: unknown): void {
    if (name === SHARE_CHANGED) {
      this.scheduleRefetch(0);
      return;
    }
    if (!this.registryInstance) return;
    applyEvent(this.syncTarget(), name, data);
    // A shared note changed: the media it embeds may have too (the server sends them with the share).
    if ((name === 'file.changed' || name === 'file.created') && isGuestNote((data as FileEvent).file.path)) this.scheduleRefetch();
    if (name === 'file.deleted' || name === 'folder.deleted' || name === 'folder.created') this.scheduleRefetch();
  }
}
