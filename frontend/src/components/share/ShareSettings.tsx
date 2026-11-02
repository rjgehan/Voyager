// Settings › Sharing (ROADMAP item 43, DESIGN §6.48): whether sharing is available, how family get
// access, and every share with its target, people, link, end date and state.
import { FileText, Folder, Pencil } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { openPath } from '../../features/navigation';
import { openShareDialog, useShares } from '../../features/shares';
import { ShareCard, SharingUnavailableNotice } from './ShareDialog';
import '../../styles/share.css';

export function ShareSettings() {
  const query = useShares();
  if (query.isPending) return <p className="muted">Loading…</p>;
  if (query.isError) return <p className="field-error">{errorMessage(query.error)}</p>;
  const { available, shares } = query.data;
  return (
    <div className="share-settings">
      {available ? (
        <p className="share-explain">
          Share one note or one folder with someone on your tailnet, to view or to edit, without the rest of the vault. Share from a note’s ⋯ menu, a
          folder’s menu in the file list, or the command palette (“Share with family”). Family need Tailscale on their device and either a place in your
          tailnet or this machine shared with their own Tailscale account (CASAOS.md or DEPLOY.md, “Sharing with family”). They open the address you send
          them; the server’s own address shows them everything shared with them.
        </p>
      ) : (
        <SharingUnavailableNotice />
      )}
      <h3 className="settings-subtitle">Shared</h3>
      {shares.length === 0 ? (
        <p className="muted">Nothing is shared.</p>
      ) : (
        <ul className="share-list">
          {shares.map((share) => (
            <li key={share.id} className="share-settings-row">
              <div className="share-settings-target">
                {share.kind === 'folder' ? <Folder size={14} aria-hidden /> : <FileText size={14} aria-hidden />}
                <strong>{share.path}</strong>
                {share.state !== 'missing' && share.kind === 'note' && (
                  <button type="button" className="button" onClick={() => openPath(share.path)}>
                    Open
                  </button>
                )}
                <button type="button" className="button" onClick={() => openShareDialog(share.path, share.kind)}>
                  <Pencil size={14} aria-hidden /> Edit…
                </button>
              </div>
              <ul className="share-list">
                <ShareCard share={share} />
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
