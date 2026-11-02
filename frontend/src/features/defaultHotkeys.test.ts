// No two commands share a default key: quick add and New tab once both had Mod-Alt-T, and the
// global handler ran whichever it found first (DESIGN §6.13, §6.25).
import { describe, expect, it } from 'vitest';
import { registerBuiltins } from '../extensions/builtins';
import { QUICK_ADD_HOTKEY } from '../tasks/register';
import { registeredViews } from '../views/registry';
import { allCommands, getCommand, type Command } from './commands';
import { defaultHotkey, normalizeSpec, reservedReason } from './hotkeyPrefs';

/** "key: id, id" for every default key that more than one of `commands` has. */
function clashes(commands: readonly Command[]): string[] {
  const byKey = new Map<string, Set<string>>();
  for (const c of commands) {
    const key = defaultHotkey(c);
    if (key) byKey.set(key, (byKey.get(key) ?? new Set()).add(c.id));
  }
  return [...byKey].filter(([, ids]) => ids.size > 1).map(([key, ids]) => `${key}: ${[...ids].sort().join(', ')}`);
}

describe('default hotkeys', () => {
  it('give no two commands the same key', () => {
    registerBuiltins();
    const commands = allCommands();
    expect(commands.length).toBeGreaterThan(50);
    expect(clashes(commands)).toEqual([]);
  });

  it('give a view’s commands keys of their own while the view is shown', () => {
    registerBuiltins();
    // The keys the global handler runs (an editor's own keys, editorHotkey, only reach their editor).
    const global = allCommands().filter((c) => c.hotkey);
    for (const view of registeredViews()) {
      const own = view.commands ?? [];
      expect(clashes(own), view.id).toEqual([]);
      expect(clashes([...global, ...own.filter((c) => !getCommand(c.id))]), view.id).toEqual([]);
    }
  });

  it('give quick add Mod-Alt-Q and leave Mod-Alt-T to New tab', () => {
    registerBuiltins();
    expect(normalizeSpec(QUICK_ADD_HOTKEY)).toBe('Mod-Alt-q');
    expect(reservedReason(QUICK_ADD_HOTKEY)).toBeNull();
    expect(getCommand('tasks.quickAdd')?.hotkey).toBe(QUICK_ADD_HOTKEY);
    expect(getCommand('tabs.new')?.hotkey).toBe('Mod-Alt-t');
  });
});
