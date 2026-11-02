// The demo's banner (DESIGN §6.46).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BANNER_CLASS, showDemoBanner } from './banner';
import { REPO_URL } from './mode';

describe('demo banner', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('says that nothing is saved, links to the repository and moves the app down', () => {
    const bar = showDemoBanner();
    expect(document.body.firstElementChild).toBe(bar);
    expect(bar.textContent).toContain('nothing is saved');
    const link = bar.querySelector('a')!;
    expect(link.href).toBe(REPO_URL);
    expect(link.rel).toBe('noopener');
    expect(document.body.classList.contains(BANNER_CLASS)).toBe(true);
  });

  it('closes, giving the app its full height back', () => {
    const resize = vi.fn();
    window.addEventListener('resize', resize);
    const bar = showDemoBanner();
    bar.querySelector('button')!.click();
    expect(bar.isConnected).toBe(false);
    expect(document.body.classList.contains(BANNER_CLASS)).toBe(false);
    expect(resize).toHaveBeenCalled();
    window.removeEventListener('resize', resize);
  });
});
