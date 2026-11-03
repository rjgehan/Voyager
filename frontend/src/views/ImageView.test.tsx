// The image view (DESIGN §6.8): fit and actual size from the keyboard as well as the pointer.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../api/types';
import ImageView from './ImageView';

const ENTRY: FileEntry = { path: 'Attachments/diagram.png', name: 'diagram.png', basename: 'diagram', extension: 'png', kind: 'image', size: 1234, mtime: '2026-11-02T10:00:00Z', version: 'v1', aliases: [] };

describe('ImageView', () => {
  it('toggles fit and actual size with a focusable button, by Enter and Space', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImageView entry={ENTRY} />);
    const stage = container.querySelector('.image-stage')!;
    const toggle = screen.getByRole('button', { name: 'Actual size' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('alt', 'diagram.png');
    // In the tab order (after the Download link).
    for (let i = 0; i < 5 && document.activeElement !== toggle; i++) await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard('{Enter}');
    expect(stage).toHaveClass('is-actual');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard(' ');
    expect(stage).not.toHaveClass('is-actual');
    await user.click(screen.getByRole('img', { hidden: true }));
    expect(stage).toHaveClass('is-actual');
  });
});
