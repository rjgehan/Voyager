// Accessible names of the CodeMirror editors (WCAG 4.1.2, DESIGN §6.19): CodeMirror gives its
// content element role=textbox, which needs a name. The first name given wins, so a wrapper
// (the decrypted note around the plain-text editor) names its editor before the inner one does.
import { Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export function editorLabel(label: string): Extension {
  return Prec.high(EditorView.contentAttributes.of({ 'aria-label': label }));
}
