// Writes vault settings with the version protocol (API.md §5, DESIGN §5.12): `PUT /api/settings
// {settings, baseVersion}`. Writes are serialized: one request in flight, the newest edit queued
// behind it and sent with the version the previous write returned, so two quick changes never
// conflict with each other. A conflict is therefore a real change from another device: the edit
// is re-applied on top of the server's settings (only the fields this tab changed), once.
// A draft is sent with the version it was made from, never with whatever the cache holds by then:
// a change from another device that reached the cache meanwhile (settings.changed) is a conflict
// too, so the draft's other fields can never silently revert it.
// Debounced edits are written when the page is left, never dropped.
// An edit that fails for want of a connection stays waiting and is resent, never silently dropped.
import { isProblem, isTransient } from '../api/client';
import type { Settings, SettingsResponse, SettingsUpdateRequest } from '../api/types';

export const WRITE_DEBOUNCE_MS = 600;
const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 30_000;

export interface SettingsWriterDeps {
  /** The cached settings (the server state this tab last saw). */
  current(): SettingsResponse | undefined;
  put(req: SettingsUpdateRequest): Promise<SettingsResponse>;
  /** Reads the server's settings now (after a conflict). */
  refetch(): Promise<SettingsResponse>;
  /** Caches the server's answer. */
  store(saved: SettingsResponse): void;
  /** True when `settings` passes validation (an invalid draft is shown, never sent). */
  valid(settings: Settings): boolean;
  /** The draft shown in the form (null: show the server's settings). */
  onDraft(draft: Settings | null): void;
  onSaving(saving: boolean): void;
  notify(message: string, kind: 'info' | 'error'): void;
  onError(error: unknown): void;
}

type Fields = Record<string, unknown>;

const isFields = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `onto` with every field where `edited` differs from `base` taken from `edited`, in every section
 * (files, daily notes, templates, editor, Ask and summaries, reminders, and any added later).
 */
export function applyDelta(base: Settings, edited: Settings, onto: Settings): Settings {
  const b = base as unknown as Fields;
  const e = edited as unknown as Fields;
  const o = onto as unknown as Fields;
  const out: Fields = { ...o };
  for (const section of Object.keys(e)) {
    const bs = b[section];
    const es = e[section];
    if (!isFields(es) || !isFields(bs)) {
      if (JSON.stringify(es) !== JSON.stringify(bs)) out[section] = es;
      continue;
    }
    let next: Fields | null = null;
    for (const key of Object.keys(es)) {
      if (JSON.stringify(es[key]) === JSON.stringify(bs[key])) continue;
      next ??= { ...(isFields(o[section]) ? o[section] : {}) };
      next[key] = es[key];
    }
    if (next) out[section] = next;
  }
  return out as unknown as Settings;
}

export class SettingsWriter {
  private readonly deps: SettingsWriterDeps;
  /** The draft shown in the form: the server's settings plus this tab's unsaved edits. */
  private latest: Settings | null = null;
  /** The server's settings the draft was made from (its version is the draft's base version). */
  private base: SettingsResponse | null = null;
  /** A write waiting for the one in flight. */
  private pending: Settings | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The form is mounted: draft and saving changes reach it. */
  private attached = true;
  /** Failed attempts in a row because the connection was down (see retryLater). */
  private retries = 0;

  constructor(deps: SettingsWriterDeps) {
    this.deps = deps;
  }

  setAttached(attached: boolean): void {
    this.attached = attached;
  }

  private showDraft(draft: Settings | null): void {
    if (this.attached) this.deps.onDraft(draft);
  }

  private showSaving(saving: boolean): void {
    if (this.attached) this.deps.onSaving(saving);
  }

  get draft(): Settings | null {
    return this.latest;
  }

  /** A change in the form: written at once (toggles, selects) or after a pause in typing. */
  update(next: Settings, immediate: boolean): void {
    // The first edit is made on the settings the form shows: the cached server state.
    if (this.latest === null) this.base = this.deps.current() ?? null;
    this.latest = next;
    this.showDraft(next);
    this.clearTimer();
    if (!this.deps.valid(next)) return;
    if (immediate) void this.write(next);
    // The timer stays set until flush() runs: flush() writes only an edit that is still waiting.
    else this.timer = setTimeout(() => void this.flush(), WRITE_DEBOUNCE_MS);
  }

  /** Writes a debounced edit now (leaving Settings, hiding the page); resolves when settled. */
  flush(): Promise<void> {
    const waiting = this.timer !== null;
    this.clearTimer();
    if (waiting && this.latest && this.deps.valid(this.latest)) return this.write(this.latest);
    return this.inFlight ?? Promise.resolve();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private write(next: Settings): Promise<void> {
    if (this.inFlight) {
      this.pending = next;
      return this.inFlight;
    }
    this.showSaving(true);
    this.inFlight = (async () => {
      try {
        let item: Settings | null = next;
        while (item) {
          await this.writeOnce(item);
          item = this.pending;
          this.pending = null;
        }
      } finally {
        this.inFlight = null;
        this.showSaving(false);
      }
    })();
    return this.inFlight;
  }

  private async writeOnce(next: Settings): Promise<void> {
    const current = this.base ?? this.deps.current();
    if (!current) return;
    try {
      const saved = await this.deps.put({ settings: next, baseVersion: current.version });
      this.retries = 0;
      this.deps.store(saved);
      // Newer edits were made on top of this one: the saved settings are their base now.
      if (this.latest === next) this.showServer();
      else this.base = saved;
      return;
    } catch (e) {
      if (isTransient(e)) {
        this.retryLater(e);
        return;
      }
      if (!isProblem(e, 'version-conflict')) {
        this.deps.onError(e);
        return;
      }
    }
    // Another device changed the settings meanwhile: this tab's edits go on top of theirs.
    try {
      const fresh = await this.deps.refetch();
      const saved = await this.deps.put({ settings: applyDelta(current.settings, next, fresh.settings), baseVersion: fresh.version });
      this.deps.store(saved);
      if (this.latest === next) this.showServer();
      else if (this.latest) this.rebase(current.settings, saved);
      this.deps.notify('Settings were also changed on another device; your change was applied on top of theirs', 'info');
    } catch (e) {
      if (isProblem(e, 'version-conflict')) {
        this.pending = null;
        this.showServer();
        this.deps.notify('Settings were changed on another device; showing their version', 'error');
      } else {
        this.deps.onError(e);
      }
    }
  }

  /**
   * The connection failed: the edit stays shown and waiting, as a debounced one does, so leaving
   * Settings or hiding the page sends it (flush), and it is resent by itself with a growing pause
   * until the connection returns. Only the first failure is reported (the offline notice).
   */
  private retryLater(e: unknown): void {
    if (this.retries === 0) this.deps.onError(e);
    const delay = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** this.retries);
    this.retries++;
    // A newer edit already has its own timer, or is queued behind this write; either sends it all.
    if (this.timer === null && this.pending === null) this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** Newer edits (shown, or queued) move onto the server's settings after a conflict. */
  private rebase(base: Settings, server: SettingsResponse): void {
    if (this.latest) {
      this.latest = applyDelta(base, this.latest, server.settings);
      this.base = server;
      this.showDraft(this.latest);
    }
    if (this.pending) this.pending = this.latest;
  }

  private showServer(): void {
    this.latest = null;
    this.base = null;
    this.showDraft(null);
  }
}
