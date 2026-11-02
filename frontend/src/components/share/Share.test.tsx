import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/endpoints';
import { queryClient } from '../../api/queryClient';
import type { ShareInfo, SharesResponse } from '../../api/types';
import { absoluteUrl, expiryFor, isValidLogin, openShareDialog, parseLogins, settingsOf, sharesOf, useShareDialog } from '../../features/shares';
import { useDialogs } from '../../state/dialogs';
import ShareDialog from './ShareDialog';
import { ShareSettings } from './ShareSettings';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

const shareInfo = (over: Partial<ShareInfo> = {}): ShareInfo => ({
  id: 'k2v8q4m1x7ab',
  path: 'Family/Groceries.md',
  kind: 'note',
  mode: 'edit',
  recipients: ['mom@example.com'],
  hasLink: false,
  linkCreatedAt: null,
  expiresAt: null,
  createdAt: '2026-11-02T10:00:00.000Z',
  createdBy: 'you@example.com',
  state: 'active',
  url: '/s/k2v8q4m1x7ab',
  ...over,
});

const response = (over: Partial<SharesResponse> = {}): SharesResponse => ({ available: true, reason: null, shares: [], ...over });

function wrap(children: ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

function confirm(answer: boolean) {
  act(() => {
    const request = useDialogs.getState().stack[0];
    if (request.kind === 'confirm') request.resolve(answer);
  });
}

describe('sharing helpers (ROADMAP item 42)', () => {
  it('reads people as Tailscale logins, as the server checks them', () => {
    expect(parseLogins('mom@example.com, dad@github;  Mom@Example.com\naunt@example.com')).toEqual({
      logins: ['mom@example.com', 'dad@github', 'aunt@example.com'],
      invalid: [],
    });
    expect(parseLogins('mom, @example.com, dad@').invalid).toEqual(['mom', '@example.com', 'dad@']);
    expect(isValidLogin('a"b@x')).toBe(false);
    expect(isValidLogin('x'.repeat(250) + '@abcd')).toBe(false);
  });

  it('computes end dates and full addresses', () => {
    const now = Date.parse('2026-11-02T10:00:00.000Z');
    expect(expiryFor('never', now)).toBeNull();
    expect(expiryFor('day', now)).toBe('2026-11-03T10:00:00.000Z');
    expect(expiryFor('week', now)).toBe('2026-11-09T10:00:00.000Z');
    expect(absoluteUrl('/s/abc', 'https://notes.example.ts.net:8443')).toBe('https://notes.example.ts.net:8443/s/abc');
  });

  it('keeps a share’s settings when one thing changes', () => {
    const share = shareInfo({ expiresAt: '2026-12-01T00:00:00.000Z' });
    expect(settingsOf(share, { link: 'new' })).toEqual({ mode: 'edit', recipients: ['mom@example.com'], link: 'new', expiresAt: '2026-12-01T00:00:00.000Z' });
    expect(sharesOf([share, shareInfo({ id: 'other', path: 'Other.md' })], 'Family/Groceries.md')).toHaveLength(1);
  });
});

describe('the share dialog', () => {
  beforeEach(() => queryClient.clear());
  afterEach(() => {
    act(() => useShareDialog.getState().close());
    vi.restoreAllMocks();
  });

  it('shares a note with people and a link, and shows the link once', async () => {
    vi.spyOn(api, 'getShares').mockResolvedValue(response());
    const create = vi.spyOn(api, 'createShare').mockResolvedValue({ share: shareInfo({ hasLink: true }), link: `/s/${TOKEN}` });
    wrap(<ShareDialog />);
    act(() => openShareDialog('Family/Groceries.md'));
    expect(await screen.findByText('Share with someone')).toBeInTheDocument();
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Can edit' }));
    fireEvent.change(screen.getByLabelText('People (their Tailscale logins)'), { target: { value: 'mom, ' } });
    expect(screen.getByText(/Not a Tailscale login: mom/)).toBeInTheDocument();
    expect(share).toBeDisabled();
    fireEvent.change(screen.getByLabelText('People (their Tailscale logins)'), { target: { value: 'mom@example.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(share);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ path: 'Family/Groceries.md', mode: 'edit', recipients: ['mom@example.com'], link: true, expiresAt: null }),
    );
    expect(await screen.findByText(absoluteUrl(`/s/${TOKEN}`))).toBeInTheDocument();
    expect(screen.getByText(/it is not shown again/)).toBeInTheDocument();
  });

  it('lists the path’s shares, renews a link in place and stops sharing after confirming', async () => {
    vi.spyOn(api, 'getShares').mockResolvedValue(response({ shares: [shareInfo({ hasLink: true, linkCreatedAt: '2026-11-02T10:00:00.000Z' }), shareInfo({ id: 'other', path: 'Other.md' })] }));
    const update = vi.spyOn(api, 'updateShare').mockResolvedValue({ share: shareInfo({ hasLink: true }), link: `/s/${TOKEN}` });
    const revoke = vi.spyOn(api, 'revokeShare').mockResolvedValue();
    wrap(<ShareDialog />);
    act(() => openShareDialog('Family/Groceries.md'));
    expect(await screen.findByText(absoluteUrl('/s/k2v8q4m1x7ab'))).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /New link/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('k2v8q4m1x7ab', { mode: 'edit', recipients: ['mom@example.com'], link: 'new', expiresAt: null }));
    expect(await screen.findByText(absoluteUrl(`/s/${TOKEN}`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Stop sharing/ }));
    await waitFor(() => expect(useDialogs.getState().stack.length).toBeGreaterThan(0));
    confirm(true);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('k2v8q4m1x7ab'));
  });

  it('explains why nothing can be shared without an owner list', async () => {
    vi.spyOn(api, 'getShares').mockResolvedValue(response({ available: false, reason: 'no-owner-list' }));
    wrap(<ShareDialog />);
    act(() => openShareDialog('Family', 'folder'));
    expect(await screen.findByText(/Sharing is off because the server has no owner list/)).toBeInTheDocument();
    expect(screen.queryByText('Share with someone')).toBeNull();
  });
});

describe('Settings › Sharing', () => {
  beforeEach(() => queryClient.clear());
  afterEach(() => vi.restoreAllMocks());

  it('lists every share with its state', async () => {
    vi.spyOn(api, 'getShares').mockResolvedValue(
      response({
        shares: [
          shareInfo(),
          shareInfo({ id: 'folder000001', path: 'Family/Recipes', kind: 'folder', mode: 'read', recipients: [], hasLink: true, state: 'expired', expiresAt: '2026-11-01T00:00:00.000Z' }),
        ],
      }),
    );
    wrap(<ShareSettings />);
    expect(await screen.findByText('Family/Groceries.md')).toBeInTheDocument();
    expect(screen.getByText('Family/Recipes')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Can view')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Stop sharing/ })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: /Edit…/ })[1]);
    expect(useShareDialog.getState()).toMatchObject({ path: 'Family/Recipes', kind: 'folder' });
  });

  it('says nothing is shared, and why when sharing is unavailable', async () => {
    vi.spyOn(api, 'getShares').mockResolvedValue(response({ available: false, reason: 'no-owner-list' }));
    wrap(<ShareSettings />);
    expect(await screen.findByText('Nothing is shared.')).toBeInTheDocument();
    expect(screen.getByText(/NOTES_IDENTITY_ALLOWED_LOGINS/)).toBeInTheDocument();
  });
});
