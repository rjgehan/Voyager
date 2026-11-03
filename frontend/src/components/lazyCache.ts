// Lazy components kept per id (panels, pages), so their identity is stable across renders. A load
// that fails (a chunk that cannot be fetched offline) is dropped from the cache: React.lazy keeps
// its result for good, so the next mount, after "Reload view" or a navigation, tries again.
import { lazy, type ComponentType } from 'react';

export function cachedLazy<P extends object>(cache: Map<string, ComponentType<P>>, key: string, load: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  const cached = cache.get(key);
  if (cached) return cached;
  const component: ComponentType<P> = lazy(() =>
    load().catch((e: unknown) => {
      if (cache.get(key) === component) cache.delete(key);
      throw e;
    }),
  );
  cache.set(key, component);
  return component;
}
