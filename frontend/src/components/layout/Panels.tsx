// Sidebar panel tabs over the registered panels (DESIGN §6.8 registerPanel). The strip follows the
// ARIA tabs pattern (§6.19): one Tab stop, the arrow keys, Home and End move between panels.
import { lazy, Suspense, type ComponentType, type KeyboardEvent } from 'react';
import { useLocation } from 'react-router';
import { registeredPanels, useExtensionsVersion, type PanelDescriptor } from '../../extensions';
import { pathFromLocation } from '../../features/paths';
import { ErrorBoundary } from '../ErrorBoundary';

const lazyPanels = new Map<string, ComponentType<{ activePath: string | null }>>();

function panelComponent(p: PanelDescriptor): ComponentType<{ activePath: string | null }> {
  if (p.component) return p.component;
  let c = lazyPanels.get(p.id);
  if (!c) {
    c = lazy(p.load);
    lazyPanels.set(p.id, c);
  }
  return c;
}

interface Props {
  side: 'left' | 'right';
  active: string;
  onSelect(id: string): void;
}

export function PanelTabs({ side, active, onSelect }: Props) {
  useExtensionsVersion();
  const panels = registeredPanels(side);
  const activePath = pathFromLocation(useLocation().pathname);
  const current = panels.find((p) => p.id === active) ?? panels[0];
  if (!current) return null;
  const Panel = panelComponent(current);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = panels.findIndex((p) => p.id === current.id);
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (i + 1) % panels.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (i - 1 + panels.length) % panels.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? panels.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(panels[next].id);
    e.currentTarget.querySelector<HTMLElement>(`#tab-${CSS.escape(panels[next].id)}`)?.focus();
  };
  return (
    <div className="panel-tabs">
      {panels.length > 1 && (
        <div className="panel-tab-strip" role="tablist" aria-label={side === 'left' ? 'Left sidebar' : 'Right sidebar'} onKeyDown={onKeyDown}>
          {panels.map((p) => {
            const Icon = p.icon;
            const selected = p.id === current.id;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={selected ? `panel-${p.id}` : undefined}
                tabIndex={selected ? 0 : -1}
                id={`tab-${p.id}`}
                className={`panel-tab${selected ? ' is-active' : ''}`}
                title={p.title}
                aria-label={p.title}
                onClick={() => onSelect(p.id)}
              >
                <Icon size={17} aria-hidden />
              </button>
            );
          })}
        </div>
      )}
      <div className="panel-body" role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`}>
        {panels.length === 1 && <h2 className="panel-title">{current.title}</h2>}
        <ErrorBoundary label="panel">
          <Suspense fallback={<div className="panel-empty">Loading…</div>}>
            {/* Panel comes from a module-level cache keyed by panel id, so its identity is stable. */}
            {/* eslint-disable-next-line react-hooks/static-components */}
            <Panel activePath={activePath} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
