// Conversations with Claude, kept per device in localStorage (ROADMAP item 18, DESIGN §6.31): the
// server keeps none. Each turn stores what was asked (as sent, so follow-ups can send it back), the
// answer and the notes that went with it; a follow-up sends the earlier turns as `history`.
// Tabs and windows of one browser share the stored list: every change is made to what is stored
// now (another tab's turns, conversations and deletions included), and a tab follows the others'
// saves through the `storage` event. A turn still streaming in this tab stays as it is here.
import { create } from 'zustand';
import type { AiPrompt, AiSource, AiTurn } from '../../api/types';
import { vaultKey } from '../../state/vault';

export const CONVERSATIONS_KEY = 'notesapp:ai:conversations';

/** Older conversations are dropped beyond these limits, so localStorage never fills up. */
export const MAX_CONVERSATIONS = 30;
export const MAX_TURNS = 40;
export const MAX_STORED_CHARS = 1_500_000;

export type TurnStatus = 'streaming' | 'done' | 'error' | 'stopped';

export interface StoredTurn {
  id: string;
  /** As sent to the server; sent back in `history` by later turns. */
  prompt: AiPrompt;
  /** What the user's side of the turn shows. */
  label: string;
  answer: string;
  sources: AiSource[];
  omitted: number;
  excluded: number;
  status: TurnStatus;
  error: string | null;
  model: string | null;
  stopReason: string | null;
  costUsd: number | null;
  at: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: StoredTurn[];
}

interface Stored {
  version: 1;
  currentId: string | null;
  conversations: Conversation[];
}

interface ConversationsState {
  conversations: Conversation[];
  currentId: string | null;
  /** Starts a turn in the current conversation (a new one when there is none) and returns its id. */
  startTurn(prompt: AiPrompt, label: string): { conversationId: string; turnId: string };
  updateTurn(conversationId: string, turnId: string, patch: Partial<StoredTurn> | ((t: StoredTurn) => Partial<StoredTurn>), persist?: boolean): void;
  newConversation(): void;
  select(id: string): void;
  remove(id: string): void;
  clearAll(): void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function titleOf(label: string): string {
  const line = label.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? line.slice(0, 59) + '…' : line || 'New conversation';
}

function isTurn(t: unknown): t is StoredTurn {
  if (!t || typeof t !== 'object') return false;
  const v = t as Partial<StoredTurn>;
  return typeof v.id === 'string' && typeof v.answer === 'string' && typeof v.label === 'string' && !!v.prompt && typeof v.prompt === 'object' && Array.isArray(v.sources);
}

export function loadStored(): Stored {
  return readStored() ?? { version: 1, currentId: null, conversations: [] };
}

/** The stored list, or null when there is none (never saved, cleared, or storage unavailable). */
function readStored(): Stored | null {
  const empty: Stored = { version: 1, currentId: null, conversations: [] };
  try {
    const raw = localStorage.getItem(vaultKey(CONVERSATIONS_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed.version !== 1 || !Array.isArray(parsed.conversations)) return empty;
    const conversations = parsed.conversations
      .filter((c): c is Conversation => !!c && typeof c.id === 'string' && Array.isArray(c.turns))
      .map((c) => ({
        ...c,
        // A page closed mid-answer left a turn streaming: it was cut off.
        turns: c.turns.filter(isTurn).map((t) => (t.status === 'streaming' ? { ...t, status: 'stopped' as const } : t)),
      }));
    const currentId = conversations.some((c) => c.id === parsed.currentId) ? (parsed.currentId ?? null) : null;
    return { version: 1, currentId, conversations };
  } catch {
    return empty;
  }
}

/** Keeps the newest conversations within the count and size limits. */
export function trimForStorage(conversations: Conversation[]): Conversation[] {
  let kept = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
  kept = kept.map((c) => (c.turns.length > MAX_TURNS ? { ...c, turns: c.turns.slice(-MAX_TURNS) } : c));
  while (kept.length > 1 && JSON.stringify(kept).length > MAX_STORED_CHARS) kept = kept.slice(0, -1);
  return kept;
}

/**
 * This tab's list brought up to date with what is stored (other tabs' turns, conversations and
 * deletions): the stored list, with the turns that are streaming in this tab kept as they are here.
 * Without a stored list (none yet, or storage unavailable) this tab's list stands.
 */
function current(local: Conversation[]): Conversation[] {
  const stored = readStored();
  if (!stored) return local;
  const live = local.filter((c) => c.turns.some((t) => t.status === 'streaming'));
  if (live.length === 0) return stored.conversations;
  const out = stored.conversations.map((c) => {
    const mine = live.find((l) => l.id === c.id);
    if (!mine) return c;
    const streaming = mine.turns.filter((t) => t.status === 'streaming');
    const ids = new Set(c.turns.map((t) => t.id));
    const turns = c.turns.map((t) => streaming.find((s) => s.id === t.id) ?? t);
    return { ...c, turns: [...turns, ...streaming.filter((t) => !ids.has(t.id))] };
  });
  // A conversation streaming here that the stored list lacks stays while it streams.
  for (const l of live) if (!out.some((c) => c.id === l.id)) out.push(l);
  return out;
}

function save(state: { conversations: Conversation[]; currentId: string | null }): Conversation[] {
  const conversations = trimForStorage(state.conversations);
  try {
    const stored: Stored = { version: 1, currentId: state.currentId, conversations };
    localStorage.setItem(vaultKey(CONVERSATIONS_KEY), JSON.stringify(stored));
  } catch {
    // Private mode or quota: the conversation still works for this page load.
  }
  return conversations;
}

const initial = loadStored();

export const useConversations = create<ConversationsState>()((set, get) => ({
  conversations: initial.conversations,
  currentId: initial.currentId,

  startTurn(prompt, label) {
    const now = Date.now();
    const turn: StoredTurn = {
      id: newId(),
      prompt,
      label,
      answer: '',
      sources: [],
      omitted: 0,
      excluded: 0,
      status: 'streaming',
      error: null,
      model: null,
      stopReason: null,
      costUsd: null,
      at: now,
    };
    let conversations = current(get().conversations);
    let currentId = get().currentId;
    let conversation = conversations.find((c) => c.id === currentId);
    if (!conversation) {
      conversation = { id: newId(), title: titleOf(label), createdAt: now, updatedAt: now, turns: [] };
      conversations = [conversation, ...conversations];
      currentId = conversation.id;
    }
    const id = conversation.id;
    conversations = conversations.map((c) => (c.id === id ? { ...c, updatedAt: now, turns: [...c.turns, turn] } : c));
    set({ conversations: save({ conversations, currentId }), currentId });
    return { conversationId: id, turnId: turn.id };
  },

  updateTurn(conversationId, turnId, patch, persist = false) {
    // Streamed text stays in this tab until the turn is saved, on top of what is stored then.
    const conversations = (persist ? current(get().conversations) : get().conversations).map((c) => {
      if (c.id !== conversationId) return c;
      return {
        ...c,
        updatedAt: Date.now(),
        turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
      };
    });
    if (persist) set({ conversations: save({ conversations, currentId: get().currentId }) });
    else set({ conversations });
  },

  newConversation() {
    const conversations = current(get().conversations);
    set({ conversations: save({ conversations, currentId: null }), currentId: null });
  },

  select(id) {
    const conversations = current(get().conversations);
    if (!conversations.some((c) => c.id === id)) return;
    set({ conversations: save({ conversations, currentId: id }), currentId: id });
  },

  remove(id) {
    const { currentId } = get();
    const rest = current(get().conversations).filter((c) => c.id !== id);
    const next = currentId === id ? null : currentId;
    set({ conversations: save({ conversations: rest, currentId: next }), currentId: next });
  },

  clearAll() {
    set({ conversations: save({ conversations: [], currentId: null }), currentId: null });
  },
}));

/** Another tab saved: this tab shows its list (keeping its own open conversation, while it exists). */
function followOtherTabs(e: StorageEvent): void {
  if (e.key !== null && e.key !== vaultKey(CONVERSATIONS_KEY)) return;
  const { conversations: local, currentId } = useConversations.getState();
  const conversations = current(local);
  useConversations.setState({ conversations, currentId: conversations.some((c) => c.id === currentId) ? currentId : null });
}

if (typeof window !== 'undefined') window.addEventListener('storage', followOtherTabs);

export function currentConversation(state: Pick<ConversationsState, 'conversations' | 'currentId'> = useConversations.getState()): Conversation | null {
  return state.conversations.find((c) => c.id === state.currentId) ?? null;
}

/**
 * The finished turns of a conversation as `history` (API.md §24.1): answered turns only, oldest
 * first, the turn being asked left out. A stopped answer goes along as far as it got.
 */
export function historyOf(conversation: Conversation | null, exceptTurnId?: string): AiTurn[] {
  if (!conversation) return [];
  return conversation.turns
    .filter((t) => t.id !== exceptTurnId && (t.status === 'done' || (t.status === 'stopped' && t.answer !== '')))
    .slice(-12)
    .map((t) => ({ prompt: t.prompt, answer: t.answer, sources: t.sources.map((s) => s.path) }));
}
