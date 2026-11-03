// The share dialog (ROADMAP item 43, DESIGN §6.48): the shares of one note or folder, and a new
// one for named people (their Tailscale logins) and/or a link. A lazy chunk: ShareOverlay (always
// loaded) mounts it only while the dialog is open.
import { Copy, Link2, Link2Off, RefreshCw, Trash2, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { errorMessage } from '../../api/client';
import type { ShareInfo, ShareMode, ShareResult } from '../../api/types';
import { formatRelative } from '../../features/format';
import { displayName } from '../../features/paths';
import {
  absoluteUrl,
  copyAddress,
  createShare,
  EXPIRY_LABELS,
  expiryFor,
  MODE_LABELS,
  parseLogins,
  revokeShare,
  settingsOf,
  sharesOf,
  STATE_LABELS,
  updateShare,
  useShareDialog,
  useShares,
  type ExpiryChoice,
} from '../../features/shares';
import { Modal } from '../overlays/Modal';
import '../../styles/share.css';

/** Why nothing can be shared yet, and the one setting that fixes it. */
export function SharingUnavailableNotice() {
  return (
    <p className="share-unavailable">
      Sharing is off because the server has no owner list: with <code>NOTES_IDENTITY_ALLOWED_LOGINS</code> unset, everyone who can reach
      Voyager on your tailnet already has the whole vault. Set it to your own Tailscale login (CASAOS.md or DEPLOY.md, “Sharing with
      family”), and everyone else sees only what you share with them.
    </p>
  );
}

/** One address to copy: a person's or the link. */
export function AddressRow({ address, label, what }: { address: string; label: string; what: string }) {
  return (
    <div className="share-address">
      <span className="share-address-label">{label}</span>
      <code>{absoluteUrl(address)}</code>
      <button type="button" className="icon-button" aria-label={`Copy ${what.toLowerCase()}`} title={`Copy ${what.toLowerCase()}`} onClick={() => void copyAddress(address, what)}>
        <Copy size={15} aria-hidden />
      </button>
    </div>
  );
}

/** What a share made or renewed a link for shows once: the server keeps only the link's hash. */
function NewLinkNotice({ result }: { result: ShareResult }) {
  if (!result.link) return null;
  return (
    <div className="share-new-link" role="status">
      <AddressRow address={result.link} label="Link" what="Link" />
      <p className="share-warning">Copy the link now: it is not shown again. Anyone on your tailnet who has it can open this share.</p>
    </div>
  );
}

export function ShareCard({ share }: { share: ShareInfo }) {
  const [busy, setBusy] = useState(false);
  // A link this card just made: shown here, once (the server keeps only its hash).
  const [made, setMade] = useState<ShareResult | null>(null);
  const run = async (action: () => Promise<ShareResult | boolean | null>) => {
    setBusy(true);
    try {
      const result = await action();
      if (result && typeof result === 'object' && result.link) setMade(result);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="share-card">
      <div className="share-card-head">
        <strong>{MODE_LABELS[share.mode]}</strong>
        {share.state !== 'active' && <span className={`share-state share-state-${share.state}`}>{STATE_LABELS[share.state]}</span>}
        <span className="muted share-card-when">
          {share.expiresAt ? `${share.state === 'expired' ? 'ended' : 'ends'} ${formatRelative(share.expiresAt)}` : 'no end date'} · made{' '}
          {formatRelative(share.createdAt)}
        </span>
      </div>
      {share.recipients.length > 0 && (
        <>
          <p className="share-people">
            <Users size={14} aria-hidden /> {share.recipients.join(', ')}
          </p>
          <AddressRow address={share.url} label="Their address" what="Address" />
        </>
      )}
      {made && <NewLinkNotice result={made} />}
      <p className="share-link-state">
        {share.hasLink ? (
          <>
            <Link2 size={14} aria-hidden /> A link anyone on your tailnet can use{share.linkCreatedAt ? `, made ${formatRelative(share.linkCreatedAt)}` : ''}
          </>
        ) : (
          <>
            <Link2Off size={14} aria-hidden /> No link
          </>
        )}
      </p>
      <div className="share-card-actions">
        <button type="button" className="button" disabled={busy} onClick={() => void run(() => updateShare(share.id, settingsOf(share, { link: 'new' })))}>
          <RefreshCw size={14} aria-hidden /> {share.hasLink ? 'New link' : 'Make a link'}
        </button>
        {share.hasLink && share.recipients.length > 0 && (
          <button type="button" className="button" disabled={busy} onClick={() => void run(() => updateShare(share.id, settingsOf(share, { link: 'none' })))}>
            <Link2Off size={14} aria-hidden /> Remove link
          </button>
        )}
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void run(() => updateShare(share.id, settingsOf(share, { mode: share.mode === 'edit' ? 'read' : 'edit' })))}
        >
          {share.mode === 'edit' ? 'Make view only' : 'Allow editing'}
        </button>
        <button type="button" className="button button-danger" disabled={busy} onClick={() => void run(() => revokeShare(share))}>
          <Trash2 size={14} aria-hidden /> Stop sharing
        </button>
      </div>
    </li>
  );
}

function NewShareForm({ path, kind, onResult }: { path: string; kind: 'note' | 'folder'; onResult(result: ShareResult): void }) {
  const [mode, setMode] = useState<ShareMode>('read');
  const [people, setPeople] = useState('');
  const [link, setLink] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryChoice>('never');
  const [busy, setBusy] = useState(false);
  const peopleId = useId();
  const parsed = parseLogins(people);
  const error =
    parsed.invalid.length > 0
      ? `Not a Tailscale login: ${parsed.invalid.join(', ')}. Logins look like name@example.com or name@github.`
      : parsed.logins.length > 20
        ? 'At most 20 people per share.'
        : null;
  const empty = parsed.logins.length === 0 && !link;

  const submit = async () => {
    if (error || empty || busy) return;
    setBusy(true);
    const result = await createShare({ path, mode, recipients: parsed.logins, link, expiresAt: expiryFor(expiry) });
    setBusy(false);
    if (result) {
      setPeople('');
      setLink(false);
      onResult(result);
    }
  };

  return (
    <form
      className="share-new"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="share-subtitle">Share with someone</h3>
      <div className="segmented share-mode" role="radiogroup" aria-label="What they can do">
        {(['read', 'edit'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <div className="field">
        <label className="field-label" htmlFor={peopleId}>
          People (their Tailscale logins)
        </label>
        <input
          id={peopleId}
          className="text-input"
          value={people}
          placeholder="mom@example.com, dad@github"
          onChange={(e) => setPeople(e.target.value)}
          aria-invalid={!!error}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="email"
        />
      </div>
      <label className="share-check">
        <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} /> Also make a link anyone on your tailnet can use
      </label>
      <label className="field share-expiry">
        <span className="field-label">Ends</span>
        <select className="select" value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}>
          {(Object.keys(EXPIRY_LABELS) as ExpiryChoice[]).map((c) => (
            <option key={c} value={c}>
              {EXPIRY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="field-error">{error}</p>}
      <p className="share-explain muted">
        They open the address in a browser with Tailscale on and see only this {kind}
        {kind === 'folder' ? ' and what is in it' : ''}: {mode === 'edit' ? 'they can edit it, and history shows who wrote what' : 'they can read it'}. Nothing
        else in your vault.
      </p>
      <div className="dialog-actions">
        <button type="submit" className="button button-primary" disabled={busy || !!error || empty}>
          Share
        </button>
      </div>
    </form>
  );
}

function ShareBody({ path, kind, onClose }: { path: string; kind: 'note' | 'folder'; onClose(): void }) {
  const query = useShares();
  const [result, setResult] = useState<ShareResult | null>(null);
  if (query.isPending) return <p className="dialog muted">Loading…</p>;
  if (query.isError) return <p className="dialog field-error">{errorMessage(query.error)}</p>;
  const existing = sharesOf(query.data.shares, path);
  return (
    <div className="dialog share-dialog">
      <h2 className="dialog-title">
        <Users size={18} aria-hidden /> Share “{displayName(path)}”
      </h2>
      {result && <NewLinkNotice result={result} />}
      {existing.length > 0 && (
        <ul className="share-list" aria-label="Shared">
          {existing.map((share) => (
            <ShareCard key={share.id} share={share} />
          ))}
        </ul>
      )}
      {query.data.available ? <NewShareForm path={path} kind={kind} onResult={setResult} /> : <SharingUnavailableNotice />}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

export default function ShareDialog() {
  const path = useShareDialog((s) => s.path);
  const kind = useShareDialog((s) => s.kind);
  const close = useShareDialog((s) => s.close);
  if (path === null) return null;
  return (
    <Modal label="Share" onClose={close} className="share-modal">
      <ShareBody key={path} path={path} kind={kind} onClose={close} />
    </Modal>
  );
}
