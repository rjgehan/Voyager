// `/x/help` and `/x/help/<page>` (DESIGN §6.45): the user guide, docs/guide/*.md bundled into this
// lazy chunk through `virtual:user-guide`, rendered read-only by the reading pipeline (markdown-it
// with callouts and highlighted code). Nothing here reads or writes the vault: links between guide
// pages stay inside Help, web links open in a new tab, and checkboxes are inert. Help's own links are
// followed by the app, never by the browser: a click in this tab, a Mod-click or a middle click in a
// new one (navigateTo reads the gesture, DESIGN §6.40).
import { ArrowLeft, ArrowRight, BookOpen, Search, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useLocation } from 'react-router';
import { usePageTitle } from '../components/pages/usePageTitle';
import { navigateTo } from '../features/navigation';
import { helpRoute, INDEX, pageOrder, pageTitle, searchGuide } from './guide';
import { guide, renderGuidePage } from './renderGuide';
import './help.css';

/** Scrolls the pane (only the pane: scrollIntoView would also move the shell's overflow-hidden boxes) to `target`, and flashes it. */
function showHeading(target: HTMLElement): void {
  const box = target.closest<HTMLElement>('.workspace-scroll');
  if (box) box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - 12;
  target.classList.remove('is-flash');
  void target.offsetWidth;
  target.classList.add('is-flash');
}

function Article({ page, anchor }: { page: string; anchor: string | null }) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (ref.current) renderGuidePage(ref.current, page);
  }, [page]);

  // Passive, so it runs after the pane's layout effect has put a new page at its top (WorkspaceScroll).
  useEffect(() => {
    const target = anchor ? ref.current?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`) : null;
    if (target) showHeading(target);
  }, [page, anchor]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const click = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-help-route]');
      if (!link || e.button !== 0) return;
      e.preventDefault();
      navigateTo(link.dataset.helpRoute!);
    };
    el.addEventListener('click', click);
    return () => el.removeEventListener('click', click);
  }, []);

  return <article ref={ref} className="markdown-rendered help-article" />;
}

function Results({ query, onPick }: { query: string; onPick(): void }) {
  const hits = useMemo(() => searchGuide(guide, query), [query]);
  const ids = useId();
  if (hits.length === 0) {
    return (
      <p className="help-empty" role="status">
        Nothing in the guide matches “{query}”. Try fewer or other words, or browse the contents.
      </p>
    );
  }
  return (
    <ul className="help-results" aria-label="Guide sections">
      {hits.map((hit, i) => (
        <li key={`${hit.page}#${hit.anchor ?? ''}`}>
          <a
            className="help-result"
            href={helpRoute(hit.page, hit.anchor)}
            aria-label={hit.heading ? `${hit.pageTitle} › ${hit.heading}` : hit.pageTitle}
            aria-describedby={hit.snippet ? `${ids}-${i}` : undefined}
            onClick={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              onPick();
              navigateTo(helpRoute(hit.page, hit.anchor));
            }}
          >
            <span className="help-result-title">
              {hit.pageTitle}
              {hit.heading && <span className="help-result-heading">{` › ${hit.heading}`}</span>}
            </span>
            {hit.snippet && (
              <span id={`${ids}-${i}`} className="help-result-snippet">
                {hit.snippet}
              </span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Neighbours({ page }: { page: string }) {
  const order = pageOrder(guide);
  const i = order.indexOf(page);
  const previous = i > 0 ? order[i - 1] : null;
  const next = i >= 0 && i + 1 < order.length ? order[i + 1] : null;
  const go = (e: ReactMouseEvent, to: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    navigateTo(helpRoute(to));
  };
  return (
    <nav className="help-neighbours" aria-label="Guide pages">
      {previous ? (
        <a className="help-neighbour" href={helpRoute(previous)} onClick={(e) => go(e, previous)}>
          <ArrowLeft size={16} aria-hidden />
          <span>
            <span className="help-neighbour-label">Previous</span>
            {pageTitle(guide[previous], previous)}
          </span>
        </a>
      ) : (
        <span />
      )}
      {next && (
        <a className="help-neighbour is-next" href={helpRoute(next)} onClick={(e) => go(e, next)}>
          <span>
            <span className="help-neighbour-label">Next</span>
            {pageTitle(guide[next], next)}
          </span>
          <ArrowRight size={16} aria-hidden />
        </a>
      )}
    </nav>
  );
}

export default function HelpPage() {
  const location = useLocation();
  // The page name, decoded from the (pane's) location as every route is (DESIGN §6.4).
  const rest = location.pathname.replace(/^\/x\/help\/?/, '');
  const page = rest ? decodeURIComponent(rest) : INDEX;
  const known = page in guide;
  const anchor = location.hash ? decodeURIComponent(location.hash.slice(1)) : null;
  // A search belongs to the place it was typed at: another page (a result picked, a link followed) starts without one.
  const at = `${page}#${anchor ?? ''}`;
  const [search, setSearch] = useState({ at, query: '' });
  const query = search.at === at ? search.query : '';
  const setQuery = (value: string) => setSearch({ at, query: value });
  const title = known ? pageTitle(guide[page], page) : 'Help';
  usePageTitle(page === INDEX || !known ? 'Help' : `${title} · Help`);

  const searching = query.trim() !== '';
  return (
    <div className="page help-page">
      <div className="help-bar">
        {page !== INDEX && (
          <a
            className="button button-small help-contents"
            href={helpRoute()}
            onClick={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              navigateTo(helpRoute());
            }}
          >
            <BookOpen size={14} aria-hidden /> Contents
          </a>
        )}
        <div className="search-field help-search">
          <Search size={14} className="search-field-icon" aria-hidden />
          <input
            type="search"
            className="text-input search-input"
            placeholder="Search the guide"
            aria-label="Search the guide"
            value={query}
            enterKeyHint="search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query !== '') {
                e.preventDefault();
                e.stopPropagation();
                setQuery('');
              }
            }}
          />
          {query !== '' && (
            <button type="button" className="icon-button search-clear" aria-label="Clear search" title="Clear search" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      {searching ? (
        <Results query={query.trim()} onPick={() => setQuery('')} />
      ) : known ? (
        <>
          <Article page={page} anchor={anchor} />
          <Neighbours page={page} />
        </>
      ) : (
        <div className="help-empty" role="status">
          <h1 className="page-title">No such help page</h1>
          <p>
            “{page}” is not a page of the guide.{' '}
            <a
              href={helpRoute()}
              onClick={(e) => {
                e.preventDefault();
                navigateTo(helpRoute());
              }}
            >
              See the contents
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}
