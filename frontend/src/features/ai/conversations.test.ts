import { beforeEach, describe, expect, it } from 'vitest';
import { CONVERSATIONS_KEY, MAX_CONVERSATIONS, currentConversation, historyOf, loadStored, trimForStorage, useConversations, type Conversation } from './conversations';

beforeEach(() => {
  useConversations.setState({ conversations: [], currentId: null });
});

describe('per-device conversations (DESIGN §6.31)', () => {
  it('starts a conversation with the first turn and keeps it in localStorage', () => {
    const { conversationId, turnId } = useConversations.getState().startTurn({ action: 'ask', question: 'Budget?' }, 'Budget?');
    const conversation = currentConversation();
    expect(conversation?.id).toBe(conversationId);
    expect(conversation?.title).toBe('Budget?');
    expect(conversation?.turns[0]).toMatchObject({ id: turnId, status: 'streaming', answer: '' });
    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!);
    expect(stored.currentId).toBe(conversationId);
  });

  it('streams into a turn and saves it once it is done', () => {
    const store = useConversations.getState();
    const { conversationId, turnId } = store.startTurn({ action: 'ask', question: 'Q' }, 'Q');
    store.updateTurn(conversationId, turnId, (t) => ({ answer: t.answer + 'Hel' }));
    store.updateTurn(conversationId, turnId, (t) => ({ answer: t.answer + 'lo' }));
    expect(JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!).conversations[0].turns[0].answer).toBe('');
    store.updateTurn(conversationId, turnId, { status: 'done' }, true);
    expect(JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!).conversations[0].turns[0]).toMatchObject({ answer: 'Hello', status: 'done' });
  });

  it('a page closed mid-answer reads back as stopped', () => {
    const store = useConversations.getState();
    const { conversationId, turnId } = store.startTurn({ action: 'ask', question: 'Q' }, 'Q');
    store.updateTurn(conversationId, turnId, { answer: 'Part' }, true);
    expect(loadStored().conversations[0].turns[0]).toMatchObject({ status: 'stopped', answer: 'Part' });
  });

  it('sends answered turns as history, with their sources', () => {
    const store = useConversations.getState();
    const a = store.startTurn({ action: 'ask', question: 'One' }, 'One');
    store.updateTurn(a.conversationId, a.turnId, { status: 'done', answer: 'First', sources: [{ path: 'A.md', chars: 5, truncated: false }] }, true);
    const b = store.startTurn({ action: 'ask', question: 'Two' }, 'Two');
    store.updateTurn(b.conversationId, b.turnId, { status: 'error', error: 'boom' }, true);
    const c = store.startTurn({ action: 'summarize', scope: 'note', path: 'B.md' }, 'Summarize B');
    expect(historyOf(currentConversation(), c.turnId)).toEqual([{ prompt: { action: 'ask', question: 'One' }, answer: 'First', sources: ['A.md'] }]);
  });

  it('a new conversation starts with the next question; old ones can be reopened or deleted', () => {
    const store = useConversations.getState();
    const first = store.startTurn({ action: 'ask', question: 'One' }, 'One');
    store.newConversation();
    expect(currentConversation()).toBeNull();
    const second = store.startTurn({ action: 'ask', question: 'Two' }, 'Two');
    expect(second.conversationId).not.toBe(first.conversationId);
    store.select(first.conversationId);
    expect(currentConversation()?.title).toBe('One');
    store.remove(first.conversationId);
    expect(useConversations.getState().conversations.map((c) => c.id)).toEqual([second.conversationId]);
    expect(currentConversation()).toBeNull();
  });

  it('keeps only the newest conversations', () => {
    const many: Conversation[] = Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, i) => ({ id: `c${i}`, title: `${i}`, createdAt: i, updatedAt: i, turns: [] }));
    const kept = trimForStorage(many);
    expect(kept).toHaveLength(MAX_CONVERSATIONS);
    expect(kept[0].id).toBe(`c${MAX_CONVERSATIONS + 4}`);
  });

  it('ignores a damaged store', () => {
    localStorage.setItem(CONVERSATIONS_KEY, '{nope');
    expect(loadStored().conversations).toEqual([]);
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify({ version: 1, currentId: 'x', conversations: [{ id: 'x', turns: [{ id: 1 }] }] }));
    expect(loadStored().conversations[0].turns).toEqual([]);
  });
});

// Two tabs (or two desktop windows) on one vault share the stored list: each saves on top of what
// the other stored, and follows the other's saves.
describe('conversations in two tabs', () => {
  const stored = () => JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!) as { currentId: string | null; conversations: Conversation[] };
  const write = (value: unknown) => {
    const newValue = JSON.stringify(value);
    localStorage.setItem(CONVERSATIONS_KEY, newValue);
    window.dispatchEvent(new StorageEvent('storage', { key: CONVERSATIONS_KEY, newValue }));
  };
  const otherTurn = (id: string, label: string) => ({ id, prompt: { action: 'ask', question: label }, label, answer: 'A ' + label, sources: [], omitted: 0, excluded: 0, status: 'done', error: null, model: null, stopReason: null, costUsd: null, at: Date.now() });

  function answered() {
    const store = useConversations.getState();
    const t1 = store.startTurn({ action: 'ask', question: 'One' }, 'One');
    store.updateTurn(t1.conversationId, t1.turnId, { status: 'done', answer: 'First' }, true);
    return t1;
  }

  it('keeps the other tab’s turns and conversations when this tab saves', () => {
    const { conversationId } = answered();
    // The other tab asks a follow-up and starts a conversation of its own.
    const value = stored();
    value.conversations[0].turns.push(otherTurn('t2', 'Two') as never);
    value.conversations[0].updatedAt = Date.now() + 1;
    value.conversations.push({ id: 'd', title: 'D', createdAt: Date.now(), updatedAt: Date.now(), turns: [] });
    write(value);
    const t3 = useConversations.getState().startTurn({ action: 'ask', question: 'Three' }, 'Three');
    expect(t3.conversationId).toBe(conversationId);
    const after = loadStored();
    expect(after.conversations.find((c) => c.id === conversationId)!.turns.map((t) => t.label)).toEqual(['One', 'Two', 'Three']);
    expect(after.conversations.some((c) => c.id === 'd')).toBe(true);
    // A follow-up sends the other tab's answer along.
    expect(historyOf(currentConversation(), t3.turnId).map((h) => h.answer)).toEqual(['First', 'A Two']);
  });

  it('saves on top of what was stored even before the other tab’s event arrives', () => {
    const { conversationId } = answered();
    const value = stored();
    value.conversations[0].turns.push(otherTurn('t2', 'Two') as never);
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(value));
    useConversations.getState().startTurn({ action: 'ask', question: 'Three' }, 'Three');
    expect(loadStored().conversations.find((c) => c.id === conversationId)!.turns.map((t) => t.label)).toEqual(['One', 'Two', 'Three']);
  });

  it('does not bring back a conversation the other tab deleted', () => {
    const { conversationId } = answered();
    useConversations.getState().newConversation();
    const value = stored();
    write({ ...value, conversations: value.conversations.filter((c) => c.id !== conversationId) });
    expect(useConversations.getState().conversations.some((c) => c.id === conversationId)).toBe(false);
    useConversations.getState().startTurn({ action: 'ask', question: 'Other' }, 'Other');
    expect(loadStored().conversations.some((c) => c.id === conversationId)).toBe(false);
  });

  it('a turn still streaming here is not cut off by the other tab’s save', () => {
    const store = useConversations.getState();
    const { conversationId, turnId } = store.startTurn({ action: 'ask', question: 'Q' }, 'Q');
    store.updateTurn(conversationId, turnId, (t) => ({ answer: t.answer + 'Hel' }));
    // The other tab saves (it read this turn as stopped, with no answer yet).
    const value = stored();
    value.conversations[0].turns[0] = { ...value.conversations[0].turns[0], status: 'stopped' };
    write(value);
    expect(currentConversation()!.turns[0]).toMatchObject({ status: 'streaming', answer: 'Hel' });
    store.updateTurn(conversationId, turnId, (t) => ({ answer: t.answer + 'lo', status: 'done' }), true);
    expect(loadStored().conversations[0].turns[0]).toMatchObject({ status: 'done', answer: 'Hello' });
  });
});
