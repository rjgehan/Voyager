// Per-device preferences (DESIGN §5.12): not vault settings, because the phone and the PC differ.
import { create } from 'zustand';

export type ThemePref = 'dark' | 'light' | 'system';
/** Markdown markup in Live Preview (DESIGN §6.6.1): always hidden, or shown for the element at the cursor. */
export type SyntaxVisibility = 'hide-all' | 'reveal-at-cursor';
/** Scripts in notes (DESIGN §6.43): run when a note shows, run on a click, or show as code. */
export type ScriptsPref = 'auto' | 'ask' | 'off';

export interface Prefs {
  theme: ThemePref;
  spellcheck: boolean;
  autocorrect: boolean;
  loadRemoteImages: boolean;
  /** Keep copies of recently opened notes, the tree and note images for offline reading (DESIGN §6.26). */
  offlineNotes: boolean;
  /** Vim keys in the note and text editors (DESIGN §6.36); used only with a mouse or trackpad. */
  vimMode: boolean;
  syntaxVisibility: SyntaxVisibility;
  /** Minutes without activity after which unlocked encrypted notes lock (DESIGN §6.33). */
  encryptionLockMinutes: number;
  /** Lock encrypted notes as soon as the app is hidden (another tab or app, the phone locked). */
  encryptionLockOnHide: boolean;
  /** Script and Dataview blocks (ROADMAP items 40 and 17): run in the sandbox as a note shows, on a click, or never. */
  scripts: ScriptsPref;
}

export const ENCRYPTION_LOCK_CHOICES = [1, 5, 10, 30, 60] as const;

export const PREFS_KEY = 'notesapp:prefs';

export const DEFAULT_PREFS: Prefs = { theme: 'dark', spellcheck: true, autocorrect: true, loadRemoteImages: true, offlineNotes: true, vimMode: false, syntaxVisibility: 'hide-all', encryptionLockMinutes: 10, encryptionLockOnHide: false, scripts: 'auto' };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'system' || parsed.theme === 'dark' ? parsed.theme : 'dark',
      spellcheck: typeof parsed.spellcheck === 'boolean' ? parsed.spellcheck : true,
      autocorrect: typeof parsed.autocorrect === 'boolean' ? parsed.autocorrect : true,
      loadRemoteImages: typeof parsed.loadRemoteImages === 'boolean' ? parsed.loadRemoteImages : true,
      offlineNotes: typeof parsed.offlineNotes === 'boolean' ? parsed.offlineNotes : true,
      vimMode: parsed.vimMode === true,
      syntaxVisibility: parsed.syntaxVisibility === 'reveal-at-cursor' ? 'reveal-at-cursor' : 'hide-all',
      encryptionLockMinutes: (ENCRYPTION_LOCK_CHOICES as readonly number[]).includes(parsed.encryptionLockMinutes as number) ? (parsed.encryptionLockMinutes as number) : 10,
      encryptionLockOnHide: typeof parsed.encryptionLockOnHide === 'boolean' ? parsed.encryptionLockOnHide : false,
      scripts: parsed.scripts === 'ask' || parsed.scripts === 'off' ? parsed.scripts : 'auto',
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

interface PrefsState extends Prefs {
  update(patch: Partial<Prefs>): void;
}

export const usePrefs = create<PrefsState>()((set, get) => ({
  ...load(),
  update(patch) {
    const before = get().theme;
    // Merged into what is stored, not this page's copy: another tab may have changed other
    // preferences since this one loaded (its 'storage' event can come late or not at all).
    let stored: Prefs;
    try {
      stored = localStorage.getItem(PREFS_KEY) === null ? pick(get()) : load();
    } catch {
      stored = pick(get());
    }
    const next: Prefs = { ...stored, ...patch };
    set(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Private mode or quota: the preference still applies to this page load.
    }
    if (next.theme !== before || patch.theme) applyTheme();
  },
}));

function pick(p: Prefs): Prefs {
  const { theme, spellcheck, autocorrect, loadRemoteImages, offlineNotes, vimMode, syntaxVisibility, encryptionLockMinutes, encryptionLockOnHide, scripts } = p;
  return { theme, spellcheck, autocorrect, loadRemoteImages, offlineNotes, vimMode, syntaxVisibility, encryptionLockMinutes, encryptionLockOnHide, scripts };
}

// Another tab of this device changed them (Settings › This device, the theme toggle): follow it, so
// this tab stops keeping offline copies when they are turned off, and shows the same theme.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== PREFS_KEY && e.key !== null) return;
    const before = usePrefs.getState().theme;
    usePrefs.setState(load());
    if (usePrefs.getState().theme !== before) applyTheme();
  });
}

export function resolvedTheme(pref: ThemePref = usePrefs.getState().theme): 'dark' | 'light' {
  if (pref === 'system') {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  return pref;
}

/** Same three updates as public/theme-boot.js, at runtime. */
export function applyTheme(): void {
  const theme = resolvedTheme();
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#1e1e1e');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'light' ? 'light dark' : 'dark light');
}

/** Follows the OS theme while the preference is `system`. */
export function installThemeListener(): void {
  if (typeof window.matchMedia !== 'function') return;
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (usePrefs.getState().theme === 'system') applyTheme();
  });
}

export function toggleTheme(): void {
  usePrefs.getState().update({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' });
}
