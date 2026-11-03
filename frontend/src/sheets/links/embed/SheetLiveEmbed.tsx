// `![[Budget.sheet]]` in a note (ROADMAP item 42, DESIGN §6.47): the spreadsheet's descriptor's
// loadEmbed() chunk. In a note that can be written it is a live grid edited in place, with the same
// workbook, number formats and merges as the spreadsheet view: it shares the file's DocumentSession
// and Workbook (views/sheet/useSheetDocument.ts), so an edit here is saved, synced, undone and
// merged as one made in the spreadsheet, and both show it at once. Until a cell is touched it is
// drawn from the file's cached values, so the formula engine loads only when it is needed (or at
// once for a spreadsheet that reads notes, whose values change on their own).
//
// Elsewhere (a locked note, an embedded note, a canvas) it is item 6b's read-only table
// (views/sheet/SheetEmbed.tsx), live for a spreadsheet that reads notes. `#chart:Spending` shows one
// chart of the spreadsheet.
import './sheetLiveEmbed.css';
import { FileSpreadsheet } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { useTextFile } from '../../../api/hooks';
import { openPath } from '../../../features/navigation';
import { noteRoute } from '../../../features/paths';
import { useDocumentSession, useSessionChangeCount, useSessionSnapshot } from '../../../sync/useTextDocument';
import { SheetChart } from '../../../views/sheet/SheetChart';
import SheetEmbed from '../../../views/sheet/SheetEmbed';
import { sheetBinding, type SheetDocument } from '../../../views/sheet/useSheetDocument';
import type { EmbedProps } from '../../../views/registry';
import { parseSheet, type SheetFile } from '../../format';
import { chartName, embedCaption, findChart, readsNotes } from '../embedTarget';
import { EmbedGrid } from './EmbedGrid';

const noSubscribe = () => () => {};
const noSnapshot = (): SheetDocument | null => null;

export default function SheetLiveEmbed(props: EmbedProps) {
  if (chartName(props.subpath) !== null) return <ChartEmbed {...props} />;
  if (props.editable) return <LiveEmbed {...props} />;
  return <ReadOnlyEmbed {...props} />;
}

/** Read-only: item 6b's table, unless the spreadsheet reads notes (its values then need the engine). */
function ReadOnlyEmbed(props: EmbedProps) {
  const file = useTextFile(props.path);
  const content = file.data?.content;
  const live = useMemo(() => {
    if (content === undefined) return false;
    const parsed = parseSheet(content);
    return parsed.ok && readsNotes(parsed.file);
  }, [content]);
  return live ? <LiveEmbed {...props} editable={false} /> : <SheetEmbed {...props} />;
}

/** The file's session and, once needed, its workbook. */
function LiveEmbed(props: EmbedProps) {
  const { path } = props;
  const session = useDocumentSession(path);
  const snapshot = useSessionSnapshot(session);
  const changes = useSessionChangeCount(session);
  const binding = sheetBinding(session);
  // The workbook is needed once a cell is touched, or at once when it is already open (the
  // spreadsheet is shown elsewhere) or reads notes.
  const [wanted, setWanted] = useState(() => binding.getSnapshot().kind === 'ready');
  // Once the workbook is ready it is the model: the session's text (which serializes the whole
  // workbook once it has been edited) is read and parsed only until then.
  const ready = binding.getSnapshot().kind === 'ready';
  const text = snapshot.loaded && !ready ? session.getText() : null;
  const parsed = useMemo(() => (text === null ? null : parseSheet(text)), [text]);
  const active = wanted || ready || (parsed?.ok === true && readsNotes(parsed.file));
  const doc = useSyncExternalStore(active ? binding.subscribe : noSubscribe, active ? binding.getSnapshot : noSnapshot);

  const workbook = doc?.kind === 'ready' ? doc.workbook : null;
  const model: SheetFile | null = workbook ? workbook.file : parsed?.ok ? parsed.file : null;
  const editable = props.editable === true && snapshot.loaded && snapshot.status !== 'readonly' && !snapshot.lossy && doc?.kind !== 'failed' && doc?.kind !== 'refused';
  let problem: string | null = null;
  if (!snapshot.loaded && snapshot.status !== 'loading') problem = `Could not load this spreadsheet. ${snapshot.error ?? ''}`.trim();
  else if (doc?.kind === 'refused') problem = `This file cannot be shown as a spreadsheet. ${doc.message}`;
  else if (parsed && !parsed.ok) problem = `This file cannot be shown as a spreadsheet. ${parsed.error}`;
  else if (doc?.kind === 'failed') problem = null; // the cached values still show, read-only

  return (
    <EmbedGrid
      path={path}
      subpath={props.subpath}
      caption={embedCaption(path, props.subpath, props.display)}
      model={model}
      workbook={workbook}
      version={doc?.kind === 'ready' ? doc.version : -changes}
      editable={editable}
      loading={!snapshot.loaded && snapshot.status === 'loading'}
      problem={problem}
      engineFailed={doc?.kind === 'failed' ? doc.message : null}
      onWant={() => setWanted(true)}
    />
  );
}

/** `#chart:Spending`: one chart, live when the spreadsheet is open here or reads notes. */
function ChartEmbed({ path, subpath, display }: EmbedProps) {
  const file = useTextFile(path);
  const content = file.data?.content;
  const parsed = useMemo(() => (content === undefined ? null : parseSheet(content)), [content]);
  const name = chartName(subpath) ?? '';
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const found = parsed?.ok ? findChart(parsed.file, name) : null;
    openPath(path, found ? found.sheet.name : null);
  };
  let body;
  if (file.isError) body = <div className="markdown-embed-empty">Could not load this spreadsheet.</div>;
  else if (!parsed) body = <div className="embed-loading">Loading…</div>;
  else if (!parsed.ok) body = <div className="markdown-embed-empty">This file cannot be shown as a spreadsheet. {parsed.error}</div>;
  else body = <LiveChart path={path} file={parsed.file} name={name} />;
  return (
    <div className="markdown-embed sheet-embed sheet-chart-embed" data-source={path} onClick={open} title="Open the spreadsheet">
      <a className="markdown-embed-title internal-link" data-href={path + (subpath ? '#' + subpath : '')} href={noteRoute(path, subpath)} onClick={open}>
        <FileSpreadsheet size={14} aria-hidden />
        <span>{embedCaption(path, subpath, display)}</span>
      </a>
      {body}
    </div>
  );
}

/** A chart from the file's cached values; from its workbook when the spreadsheet reads notes. */
function LiveChart({ path, file, name }: { path: string; file: SheetFile; name: string }) {
  return readsNotes(file) ? <BoundChart path={path} file={file} name={name} /> : <ChartOf model={file} name={name} version={0} />;
}

function BoundChart({ path, file, name }: { path: string; file: SheetFile; name: string }) {
  const session = useDocumentSession(path);
  const binding = sheetBinding(session);
  const doc = useSyncExternalStore(binding.subscribe, binding.getSnapshot);
  return doc.kind === 'ready' ? <ChartOf model={doc.workbook.file} name={name} version={doc.version} /> : <ChartOf model={file} name={name} version={0} />;
}

function ChartOf({ model, name, version }: { model: SheetFile; name: string; version: number }) {
  const found = findChart(model, name);
  if (!found) return <div className="markdown-embed-empty">{name ? `This spreadsheet has no chart “${name}”.` : 'This spreadsheet has no chart.'}</div>;
  return <SheetChart key={`${found.sheet.id}:${found.id}:${version}`} sheet={found.sheet} chart={found.chart} height={200} />;
}
