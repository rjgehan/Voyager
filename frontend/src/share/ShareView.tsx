// One share on the guest page (ROADMAP item 43, DESIGN §6.48): its note, or its folder's files
// beside the open note, in the owner's Live Preview editor with the owner's save and sync
// machinery pointed at the share's endpoints. A lazy chunk: the landing page does not load it.
import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ArrowLeft, CircleAlert, Copy, Eye, File, FilePlus, FileText, Folder, Image, Music, Pencil, Video } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '../api/client';
import type { FileEntry, GuestShareResponse, TreeResponse } from '../api/types';
import { queryKeys } from '../api/queryKeys';
import { SaveStatus } from '../components/SaveStatus';
import { vaultChanged } from '../editor/context';
import { noteExtensions, type EditorHooks } from '../editor/editorSetup';
import { displayName, folderOf, joinPath, newNameError } from '../features/paths';
import { isPhoneLayout, PHONE_QUERY } from '../features/platform';
import { promptText } from '../state/dialogs';
import { usePrefs } from '../state/prefs';
import { toast } from '../state/toasts';
import { vaultBasename } from '../state/vault';
import type { DocumentSession } from '../sync/DocumentSession';
import type { DocumentRegistry } from '../sync/documents';
import { guestHref, parseGuestRoute } from './guestApi';
import { guestNoteContext, type GuestEnv } from './guestContext';
import { GuestSync, inShare, isGuestNote, type GuestState } from './guestSync';
import { setTitle } from './page';
import { LandingLink, Loading, Problem } from './parts';

function stateProblem(state: GuestState) {
  if (state.status === 'ended') {
    return (
      <Problem
        title="This share is not available"
        detail="It may have ended, its link may have been replaced, or it is not shared with your Tailscale login."
        action={<LandingLink />}
      />
    );
  }
  if (state.status === 'limited') {
    const minutes = state.retryAfterS === null ? null : Math.max(1, Math.ceil(state.retryAfterS / 60));
    return (
      <Problem
        title="Too many attempts"
        detail={`This device asked for too many shares or files it may not open. Try again ${minutes === null ? 'later' : `in ${minutes} minute${minutes === 1 ? '' : 's'}`}.`}
      />
    );
  }
  if (state.status === 'error') {
    return (
      <Problem
        title="Can’t open this share"
        detail={state.message}
        action={
          <button type="button" className="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        }
      />
    );
  }
  return null;
}

function kindIcon(entry: FileEntry) {
  if (entry.kind === 'note') return <FileText size={15} aria-hidden />;
  if (entry.kind === 'image') return <Image size={15} aria-hidden />;
  if (entry.kind === 'audio') return <Music size={15} aria-hidden />;
  if (entry.kind === 'video') return <Video size={15} aria-hidden />;
  return <File size={15} aria-hidden />;
}

// ---------- the open note ----------

/** The session of `path` held for this component's life (like the owner's useDocumentSession). */
function useGuestSession(registry: DocumentRegistry, path: string): DocumentSession {
  const holder = useId();
  const [session, setSession] = useState(() => registry.acquire(path, holder));
  const [heldPath, setHeldPath] = useState(path);
  const disposed = useSyncExternalStore(session.subscribe, () => session.isDisposed);
  if (heldPath !== path) {
    setHeldPath(path);
    if (session.path !== path) setSession(registry.acquire(path, holder));
  } else if (disposed) {
    setSession(registry.acquire(path, holder));
  }
  useEffect(() => {
    registry.hold(session, holder);
    return () => registry.release(session, holder);
  }, [registry, session, holder]);
  return session;
}

function GuestEditor({ session, env, readOnly, treeKey, autoFocus }: { session: DocumentSession; env: GuestEnv; readOnly: boolean; treeKey: unknown; autoFocus: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  // Only the first mount takes the focus (a note just created), not a remount for a preference.
  const focusAtMount = useRef(autoFocus);
  const view = useRef<EditorView | null>(null);
  const spellcheck = usePrefs((s) => s.spellcheck);
  const autocorrect = usePrefs((s) => s.autocorrect);
  const syntaxVisibility = usePrefs((s) => s.syntaxVisibility);
  const remoteImages = usePrefs((s) => s.loadRemoteImages);

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const hooks: EditorHooks = {
      onLocalChange: () => session.markDirty(),
      onBlur: () => void session.flush(),
      readOnly,
      spellcheck,
      autocorrect,
      vim: false,
      livePreview: { visibility: syntaxVisibility, locked: readOnly, checkboxes: !readOnly, remoteImages, scripts: 'off' },
    };
    const extensions = noteExtensions(guestNoteContext(env, session), hooks);
    const state = session.prepareState((st) => st.update({ effects: StateEffect.reconfigure.of(extensions) }).state);
    const v = new EditorView({ state, parent, dispatchTransactions: (trs, ev) => session.routeTransactions(ev, trs) });
    view.current = v;
    session.attach(v);
    if (focusAtMount.current && !readOnly) v.focus();
    focusAtMount.current = false;
    return () => {
      session.detach(v);
      v.destroy();
      view.current = null;
    };
  }, [session, env, readOnly, spellcheck, autocorrect, syntaxVisibility, remoteImages]);

  // Links and embeds re-resolve when the share's files change.
  useEffect(() => {
    view.current?.dispatch({ effects: vaultChanged.of(null) });
  }, [treeKey]);

  return <div ref={host} className="note-editor" />;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('The browser refused clipboard access', { kind: 'error' });
  }
}

function GuestNote({ sync, path, editable, env, treeKey, autoFocus }: { sync: GuestSync; path: string; editable: boolean; env: GuestEnv; treeKey: unknown; autoFocus: boolean }) {
  const session = useGuestSession(sync.registry, path);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const readOnly = !editable || snapshot.status === 'readonly' || snapshot.lossy || snapshot.deleted !== null;
  return (
    <div className="markdown-view is-readable guest-note">
      <div className="guest-note-head">
        <h1 className="guest-note-title">{displayName(path)}</h1>
        {editable && <SaveStatus snapshot={snapshot} />}
      </div>
      {snapshot.status === 'conflict' && snapshot.conflict && (
        <div className="conflict-banner" role="alert" data-covers-top>
          <div className="conflict-banner-text">
            <CircleAlert size={16} aria-hidden />
            <span>This note was changed by someone else while you were editing it.</span>
          </div>
          <div className="conflict-banner-actions">
            <button type="button" className="button button-small button-primary" disabled={busy} onClick={() => void run(() => session.keepMine())}>
              Keep mine
            </button>
            <button type="button" className="button button-small" disabled={busy} onClick={() => void run(() => session.takeTheirs())}>
              Take theirs
            </button>
            <button type="button" className="button button-small" onClick={() => void copyText(session.getText())}>
              <Copy size={14} aria-hidden /> Copy mine
            </button>
          </div>
        </div>
      )}
      {snapshot.deleted && (
        <div className="conflict-banner" role="alert">
          <div className="conflict-banner-text">
            <CircleAlert size={16} aria-hidden />
            <span>This note was deleted by its owner.{snapshot.deleted.hasLocalEdits ? ' Your unsaved changes are still shown: copy them to keep them.' : ''}</span>
          </div>
          {snapshot.deleted.hasLocalEdits && (
            <div className="conflict-banner-actions">
              <button type="button" className="button button-small" onClick={() => void copyText(session.getText())}>
                <Copy size={14} aria-hidden /> Copy my text
              </button>
            </div>
          )}
        </div>
      )}
      {snapshot.status === 'error' && snapshot.loaded && snapshot.error && (
        <p className="guest-save-error" role="alert">
          {snapshot.error}
        </p>
      )}
      {snapshot.status === 'loading' ? (
        <Loading />
      ) : !snapshot.loaded ? (
        <div className="error-panel" role="alert">
          <p className="error-panel-title">This note could not be opened.</p>
          <p className="error-panel-detail">{snapshot.error}</p>
          <button type="button" className="button" onClick={() => void session.reload()}>
            Try again
          </button>
        </div>
      ) : (
        <GuestEditor session={session} env={env} readOnly={readOnly} treeKey={treeKey} autoFocus={autoFocus} />
      )}
    </div>
  );
}

function MediaView({ entry, env }: { entry: FileEntry; env: GuestEnv }) {
  const url = env.rawUrl(entry);
  return (
    <div className="guest-media">
      <h1 className="guest-note-title">{entry.name}</h1>
      {entry.kind === 'image' && <img src={url} alt={entry.basename} className="guest-media-image" />}
      {entry.kind === 'audio' && <audio src={url} controls preload="metadata" />}
      {entry.kind === 'video' && <video src={url} controls playsInline preload="metadata" className="guest-media-video" />}
      <p>
        <a className="button" href={entry.kind === 'pdf' || entry.kind === 'image' ? url : env.rawUrl(entry, { download: true })} target="_blank" rel="noopener">
          {entry.kind === 'pdf' ? 'Open the PDF' : entry.kind === 'image' ? 'Open the image' : 'Download'}
        </a>
      </p>
      {entry.kind !== 'image' && entry.kind !== 'audio' && entry.kind !== 'video' && entry.kind !== 'pdf' && (
        <p className="guest-explain">This kind of file can’t be shown here.</p>
      )}
    </div>
  );
}

// ---------- a folder's files ----------

function FileList({
  share,
  files,
  open,
  hrefOf,
  onOpen,
  onNewNote,
}: {
  share: GuestShareResponse;
  files: FileEntry[];
  open: string | null;
  hrefOf(path: string): string;
  onOpen(path: string): void;
  onNewNote: (() => void) | null;
}) {
  const groups = useMemo(() => {
    const byFolder = new Map<string, FileEntry[]>();
    for (const f of files) {
      const folder = folderOf(f.path);
      const list = byFolder.get(folder) ?? [];
      list.push(f);
      byFolder.set(folder, list);
    }
    return [...byFolder.entries()]
      .sort(([a], [b]) => (a === share.path ? -1 : b === share.path ? 1 : a.localeCompare(b)))
      .map(([folder, list]) => [folder, list.sort((x, y) => x.name.localeCompare(y.name))] as const);
  }, [files, share.path]);
  return (
    <nav className="guest-files" aria-label={`Files in ${share.title}`}>
      {onNewNote && (
        <button type="button" className="button guest-new-note" onClick={onNewNote}>
          <FilePlus size={15} aria-hidden /> New note
        </button>
      )}
      {groups.length === 0 && <p className="guest-explain">This folder is empty.</p>}
      {groups.map(([folder, list]) => (
        <div key={folder} className="guest-files-group">
          {folder !== share.path && (
            <div className="guest-files-folder">
              <Folder size={14} aria-hidden /> {folder.slice(share.path.length + 1)}
            </div>
          )}
          <ul>
            {list.map((f) => (
              <li key={f.path}>
                <a
                  href={hrefOf(f.path)}
                  className={`guest-file${f.path === open ? ' is-active' : ''}`}
                  aria-current={f.path === open ? 'page' : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    onOpen(f.path);
                  }}
                >
                  {kindIcon(f)}
                  <span>{isGuestNote(f.path) ? f.basename : f.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// ---------- a share ----------

function usePhone(): boolean {
  const [phone, setPhone] = useState(isPhoneLayout);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

export default function ShareView({ shareKey, path, navigate }: { shareKey: string; path: string | null; navigate(href: string, replace?: boolean): void }) {
  const [sync] = useState(() => new GuestSync(shareKey));
  useEffect(() => {
    void sync.start();
    return () => sync.stop();
  }, [sync]);
  const state = useSyncExternalStore(sync.subscribe, sync.getState);
  const tree = useSyncExternalStore(
    useCallback((fn: () => void) => sync.qc.getQueryCache().subscribe(fn), [sync]),
    () => sync.qc.getQueryData<TreeResponse>(queryKeys.tree()) ?? null,
  );
  const phone = usePhone();
  // The note this page just created: its editor takes the focus.
  const [created, setCreated] = useState<string | null>(null);
  const base = vaultBasename();
  const open = useCallback((p: string | null, replace = false) => navigate(guestHref(base, shareKey, p), replace), [navigate, base, shareKey]);

  useEffect(() => {
    sync.setSessionMoved((from, to) => {
      const route = parseGuestRoute(window.location.pathname, window.location.search);
      if (route.kind === 'share' && route.path === from) open(to, true);
    });
  }, [sync, open]);

  const env = useMemo<GuestEnv>(
    () => ({
      tree: () => sync.tree(),
      shared: (p) => {
        const s = sync.getState();
        return s.status === 'ready' && inShare(s.share, p);
      },
      rawUrl: (entry, opts) => sync.api.rawUrl(entry, opts),
      openNote: (p) => open(p),
      readText: async (p) => (await sync.api.readFile(p)).content,
      remoteImages: () => usePrefs.getState().loadRemoteImages,
    }),
    [sync, open],
  );

  const share = state.status === 'ready' ? state.share : null;
  useEffect(() => {
    if (share) setTitle(path ? displayName(path) : share.title);
  }, [share, path]);

  if (state.status === 'loading') return <Loading />;
  if (!share) return stateProblem(state);

  const files = (tree?.files ?? []).filter((f) => inShare(share, f.path));
  const editable = share.mode === 'edit';
  const target = share.kind === 'note' ? share.path : path;
  const entry = target ? (tree?.files ?? []).find((f) => f.path === target && inShare(share, f.path)) : undefined;

  const newNote =
    share.kind === 'folder' && editable
      ? async () => {
          const name = await promptText({
            title: 'New note',
            label: `Name (in ${share.title})`,
            value: '',
            placeholder: 'Note name',
            confirmLabel: 'Create',
            validate: (v) => (v.trim() === '' ? null : newNameError(v.trim())),
          });
          if (!name || !name.trim()) return;
          const fileName = /\.md$/i.test(name.trim()) ? name.trim() : name.trim() + '.md';
          try {
            const result = await sync.api.createFile({ path: joinPath(share.path, fileName), content: '', onConflict: 'rename' });
            await sync.refetch();
            setCreated(result.file.path);
            open(result.file.path);
          } catch (e) {
            toast(errorMessage(e), { kind: 'error' });
          }
        }
      : null;

  const listOnly = share.kind === 'folder' && phone && !target;
  const main =
    share.kind === 'folder' && !target ? (
      <div className="guest-pick">
        <p className="guest-explain">Pick a note or file{phone ? '' : ' on the left'}.</p>
      </div>
    ) : !entry ? (
      <Problem title="Not found" detail={target && !inShare(share, target) ? 'That file is not part of this share.' : 'This note no longer exists. Its owner may have deleted or moved it.'} />
    ) : isGuestNote(entry.path) ? (
      <GuestNote key={entry.path} sync={sync} path={entry.path} editable={editable} env={env} treeKey={tree} autoFocus={entry.path === created} />
    ) : (
      <MediaView entry={entry} env={env} />
    );

  return (
    <div className={`guest-share${share.kind === 'folder' ? ' is-folder' : ''}`}>
      <header className="guest-header">
        {share.kind === 'folder' && phone && target && (
          <button type="button" className="icon-button" aria-label={`Back to ${share.title}`} title={`Back to ${share.title}`} onClick={() => open(null)}>
            <ArrowLeft size={18} aria-hidden />
          </button>
        )}
        <div className="guest-header-text">
          <span className="guest-header-title">
            {share.kind === 'folder' ? <Folder size={16} aria-hidden /> : <FileText size={16} aria-hidden />} {share.title}
          </span>
          <span className="guest-header-meta">
            <span className="guest-badge">
              {editable ? <Pencil size={12} aria-hidden /> : <Eye size={12} aria-hidden />} {editable ? 'Can edit' : 'View only'}
            </span>{' '}
            Shared by {share.sharedBy}
          </span>
        </div>
      </header>
      <div className="guest-body">
        {share.kind === 'folder' && (!phone || listOnly) && <FileList share={share} files={files} open={target} hrefOf={(p) => guestHref(base, shareKey, p)} onOpen={(p) => open(p)} onNewNote={newNote} />}
        {!listOnly && <div className="guest-main">{main}</div>}
      </div>
    </div>
  );
}
