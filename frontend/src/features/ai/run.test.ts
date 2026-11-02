import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpEndpoints, installEndpoints } from '../../api/endpoints';
import { createMockEndpoints } from '../../api/mock';
import { MockVault } from '../../api/mock/vault';
import { queryClient } from '../../api/queryClient';
import { documents } from '../../sync/instance';
import { useConversations } from './conversations';
import { askQuestion, isStreaming, summarize } from './run';

const START = 'event:start\ndata:{"model":"m","sources":[],"omitted":0,"excluded":0}\n\n';

/** A stream that starts and then waits until its request is aborted. */
function openStream(signal: AbortSignal | null | undefined): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(START));
      signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')));
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

let signal: AbortSignal | undefined;
let requests: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  useConversations.setState({ conversations: [], currentId: null });
  signal = undefined;
  requests = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

afterAll(() => installEndpoints(httpEndpoints));

function stubAi(onRequest: () => void = () => {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      onRequest();
      signal = init?.signal ?? undefined;
      requests.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
      return openStream(init?.signal);
    }),
  );
}

describe('asking and summarizing', () => {
  it('saves the open note first, so the answer reads what was just typed', async () => {
    const vault = new MockVault(false);
    vault.createFile({ path: 'Plan.md', content: 'Budget is 10k' }, 'other-device-1');
    installEndpoints(createMockEndpoints(vault, { latency: 0, failures: [] }));
    const session = documents.acquire('Plan.md', 'ai-test');
    await session.ready;
    session.applyEdit({ from: session.getText().length, insert: ', now 12k' });
    let savedAtRequest: string | null = null;
    stubAi(() => (savedAtRequest = vault.readFile('Plan.md').content));
    summarize({ scope: 'note', path: 'Plan.md' }, 'Summarize [[Plan]]');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(savedAtRequest).toBe('Budget is 10k, now 12k');
    documents.release(session, 'ai-test');
  });

  it('deleting a conversation stops its answer', async () => {
    stubAi();
    const turnId = askQuestion('What is the budget?', null);
    await vi.waitFor(() => expect(signal).toBeDefined());
    useConversations.getState().remove(useConversations.getState().currentId!);
    await vi.waitFor(() => expect(signal!.aborted).toBe(true));
    await vi.waitFor(() => expect(isStreaming(turnId)).toBe(false));
  });

  it('clearing every conversation stops their answers', async () => {
    stubAi();
    const turnId = askQuestion('What is the budget?', null);
    await vi.waitFor(() => expect(signal).toBeDefined());
    useConversations.getState().clearAll();
    await vi.waitFor(() => expect(signal!.aborted).toBe(true));
    await vi.waitFor(() => expect(isStreaming(turnId)).toBe(false));
    expect(useConversations.getState().conversations).toEqual([]);
  });
});
