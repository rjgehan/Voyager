// Sharing with family (ROADMAP item 43, DESIGN §6.48) through the extension points (§6.8): the
// share dialog as an overlay and a palette command for the open note. The dialog says when
// sharing is unavailable on the server, so the command is always offered for notes.
import { Users } from 'lucide-react';
import { currentTree } from '../../api/hooks';
import { registerCommand, registerOverlay } from '../../extensions';
import { openShareDialog } from '../../features/shares';
import { isMarkdownViewPath } from '../../views/registry';
import { ShareOverlay } from './ShareOverlay';

/** Plain Markdown notes (not drawings stored as `.excalidraw.md`), as the server shares them. */
export function canShareNote(path: string | null): path is string {
  return path !== null && isMarkdownViewPath(path) && /\.md$/i.test(path) && currentTree().byPath.get(path)?.kind === 'note';
}

export function registerShare(): void {
  registerOverlay({ id: 'share', component: ShareOverlay });
  registerCommand({
    id: 'file.share',
    name: 'Share with family',
    icon: Users,
    when: (c) => canShareNote(c.activePath),
    run: (c) => openShareDialog(c.activePath!, 'note'),
  });
}
