import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_OPTIONS } from '../../features/graph/options';
import type { ViewGraph, ViewNode } from '../../features/graph/model';
import { bucketsOf, bulkLinkWidth, drawFrame, FALLBACK_THEME, fitTransform, hitTest, labelAlpha, MAX_ZOOM, MIN_ZOOM, nodeFills, nodeRadius, toWorld, zoomAround } from './renderer';

const vnode = (id: string, type: ViewNode['type'], degree = 1): ViewNode => ({ id, path: id, label: id, type, tags: [], aliases: [], degree });

describe('graph renderer geometry', () => {
  it('zooms around a fixed screen point and clamps the zoom', () => {
    const t = { x: 100, y: 50, k: 1 };
    const z = zoomAround(t, 200, 150, 2);
    expect(z.k).toBe(2);
    expect(toWorld(z, 200, 150)).toEqual(toWorld(t, 200, 150));
    expect(zoomAround(t, 0, 0, 1e6).k).toBe(MAX_ZOOM);
    expect(zoomAround(t, 0, 0, 1e-6).k).toBe(MIN_ZOOM);
  });

  it('fits placed nodes into the viewport, ignoring unplaced ones', () => {
    const p = Float32Array.from([-100, -50, 100, 50, NaN, NaN]);
    const t = fitTransform(p, 3, 400, 300, 0, 10);
    expect(t.k).toBeCloseTo(2);
    expect(t.x).toBeCloseTo(200);
    expect(t.y).toBeCloseTo(150);
    expect(fitTransform(new Float32Array(0), 0, 400, 300)).toEqual({ x: 200, y: 150, k: 1 });
  });

  it('finds the node under the pointer with some slack, preferring the closest', () => {
    const p = Float32Array.from([0, 0, 30, 0]);
    const r = Float32Array.from([5, 5]);
    expect(hitTest(p, r, 2, 2, 0, 1, 0)).toBe(0);
    expect(hitTest(p, r, 2, 28, 1, 1, 0)).toBe(1);
    expect(hitTest(p, r, 2, 15, 0, 1, 0)).toBe(-1);
    expect(hitTest(p, r, 2, 15, 0, 1, 12)).toBe(0);
    expect(hitTest(null, r, 2, 0, 0, 1, 5)).toBe(-1);
  });

  it('grows nodes with their links and fades labels in with the zoom', () => {
    expect(nodeRadius(0, 1)).toBeLessThan(nodeRadius(16, 1));
    expect(nodeRadius(10_000, 1)).toBe(22);
    expect(labelAlpha(0.2, 0)).toBe(0);
    expect(labelAlpha(3, 0)).toBe(1);
    expect(labelAlpha(0.6, 3)).toBeGreaterThan(labelAlpha(0.6, 0));
  });

  it('colors nodes by group, then by type, and draws in batches', () => {
    const view: ViewGraph = {
      nodes: [vnode('a.md', 'note', 1), vnode('b.md', 'note', 2), vnode('pic.png', 'attachment', 1), vnode('#t', 'tag', 0)],
      links: Int32Array.from([0, 1, 1, 1, 2, 3]),
      center: -1,
    };
    const fills = nodeFills(view, ['#ff0000', null, null, null], FALLBACK_THEME);
    expect(fills).toEqual(['#ff0000', FALLBACK_THEME.node, FALLBACK_THEME.attachment, FALLBACK_THEME.tag]);
    const buckets = bucketsOf(fills);
    expect(buckets.map((b) => [b.color, [...b.nodes]])).toEqual([
      ['#ff0000', [0]],
      [FALLBACK_THEME.node, [1]],
      [FALLBACK_THEME.attachment, [2]],
      [FALLBACK_THEME.tag, [3]],
    ]);

    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) => (prop in target ? target[prop] : (...args: unknown[]) => calls.push(`${prop}(${args.length})`)),
      set: (target, prop: string, value) => {
        target[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const positions = Float32Array.from([0, 0, 40, 0, 40, 40, 0, 40]);
    drawFrame(ctx, {
      width: 400,
      height: 300,
      dpr: 2,
      transform: { x: 200, y: 150, k: 2 },
      view,
      positions,
      radii: Float32Array.from(view.nodes, (n) => nodeRadius(n.degree, 1)),
      buckets,
      theme: FALLBACK_THEME,
      display: { ...DEFAULT_GRAPH_OPTIONS, showArrow: true },
      hover: 1,
      highlighted: Uint8Array.from([1, 1, 1, 0]),
      focus: 0,
    });
    // One stroke per link style (dimmed, highlighted), fills per color and pass, labels as text.
    expect(calls.filter((c) => c.startsWith('stroke(')).length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.startsWith('fillText(')).length).toBe(3);
    expect(calls.filter((c) => c.startsWith('arc(')).length).toBeGreaterThanOrEqual(4);
  });

  it('draws the bulk of the links as hairlines, on the CSS-pixel layer when there is one', () => {
    // At most one pixel of the surface they are drawn on: wider strokes are tessellated per segment, an order of
    // magnitude slower with tens of thousands of links.
    expect(bulkLinkWidth(1.6, 1)).toBe(1);
    expect(bulkLinkWidth(0.5, 1)).toBe(0.5);
    expect(bulkLinkWidth(1.6, 2)).toBe(0.5);
    const recorder = (log: string[], name: string) =>
      new Proxy({ canvas: { name } } as Record<string, unknown>, {
        get: (target, prop: string) =>
          prop in target ? target[prop] : () => log.push(`${name}.${prop}${prop === 'stroke' ? '@' + String(target.lineWidth) : ''}`),
        set: (target, prop: string, value) => {
          target[prop] = value;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
    const view: ViewGraph = { nodes: [vnode('a.md', 'note', 2), vnode('b.md', 'note', 2), vnode('c.md', 'note', 1)], links: Int32Array.from([0, 1, 1, 1, 2, 1]), center: -1 };
    const frame = (hover: number, layer: CanvasRenderingContext2D | null, log: string[]) => {
      const ctx = recorder(log, 'main');
      drawFrame(ctx, {
        width: 400,
        height: 300,
        dpr: 2,
        transform: { x: 200, y: 150, k: 4 },
        view,
        positions: Float32Array.from([0, 0, 20, 0, 20, 20]),
        radii: Float32Array.from([3, 3, 3]),
        buckets: bucketsOf(nodeFills(view, [null, null, null], FALLBACK_THEME)),
        theme: FALLBACK_THEME,
        display: DEFAULT_GRAPH_OPTIONS,
        hover,
        highlighted: hover >= 0 ? Uint8Array.from([1, 1, 0]) : null,
        focus: -1,
        linkLayer: layer,
      });
    };
    // k = 4: the links would be 1.6 CSS pixels (3.2 device pixels) wide.
    let log: string[] = [];
    frame(-1, recorder(log, 'layer'), log);
    expect(log.filter((c) => c.includes('stroke@'))).toEqual(['layer.stroke@0.25']);
    expect(log).toContain('main.drawImage');
    log = [];
    frame(-1, null, log);
    expect(log.filter((c) => c.includes('stroke@'))).toEqual(['main.stroke@0.125']);
    // Hovering: the dimmed links stay hairlines, the hovered node's links keep their width.
    log = [];
    frame(0, recorder(log, 'layer'), log);
    const strokes = log.filter((c) => c.includes('stroke@')).map((c) => [c.slice(0, c.indexOf('@')), Number(c.slice(c.indexOf('@') + 1))] as const);
    expect(strokes[0]).toEqual(['layer.stroke', 0.25]);
    expect(strokes[1]![0]).toBe('main.stroke');
    expect(strokes[1]![1]).toBeCloseTo(0.64);
  });
});
