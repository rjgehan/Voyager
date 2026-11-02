/**
 * Listens to the live event stream (API.md §16) the way a second device does, so tests can check
 * what other devices are told.
 */
import { randomUUID } from 'node:crypto';
import { API_URL, apiPath } from './api.ts';

export interface SseEvent {
  event: string;
  id: string | null;
  data: any;
}

export class EventStream {
  readonly clientId: string;
  readonly events: SseEvent[] = [];
  private controller = new AbortController();
  private waiters: (() => void)[] = [];

  private constructor(clientId: string) {
    this.clientId = clientId;
  }

  /** Opens a stream as a device with its own client id; resolves once `hello` arrived. */
  static async open({ clientId = `e2e-sse-${randomUUID()}`, lastEventId, vault }: { clientId?: string; lastEventId?: string; vault?: string } = {}) {
    const s = new EventStream(clientId);
    const params = new URLSearchParams({ clientId });
    if (lastEventId) params.set('lastEventId', lastEventId);
    const res = await fetch(`${API_URL}${apiPath('/api/events', vault)}?${params}`, {
      headers: { accept: 'text/event-stream' },
      signal: s.controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`events: ${res.status}`);
    void s.read(res.body);
    await s.next((e) => e.event === 'hello');
    return s;
  }

  private async read(body: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of body as any as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let event = 'message';
          let id: string | null = null;
          const data: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('id:')) id = line.slice(3).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).trim());
          }
          if (!data.length) continue;
          let parsed: any = data.join('\n');
          try {
            parsed = JSON.parse(parsed);
          } catch {
            /* keep text */
          }
          this.events.push({ event, id, data: parsed });
          for (const w of this.waiters.splice(0)) w();
        }
      }
    } catch {
      /* aborted */
    }
  }

  /** The first event (already received or still to come) that matches, within `timeout` ms. */
  async next(match: (e: SseEvent) => boolean, timeout = 10_000): Promise<SseEvent> {
    const until = Date.now() + timeout;
    for (;;) {
      const hit = this.events.find(match);
      if (hit) return hit;
      const left = until - Date.now();
      if (left <= 0) throw new Error(`No matching event within ${timeout} ms; got: ${this.events.map((e) => e.event).join(', ')}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => (clearTimeout(t), resolve()));
      });
    }
  }

  close() {
    this.controller.abort();
  }
}
