// Sharing with family (ROADMAP item 42, DESIGN §6.45), the owner's side: the shares query, the
// share dialog's target, the create / change / revoke actions, and the addresses to copy. The
// server decides what a share reaches (DESIGN §5.40); nothing here grants anything by itself.
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from '../api/endpoints';
import { queryClient } from '../api/queryClient';
import { queryKeys, STALE } from '../api/queryKeys';
import type { CreateShareRequest, IsoInstant, ShareInfo, ShareMode, ShareResult, ShareState, UpdateShareRequest } from '../api/types';
import { confirmAction } from '../state/dialogs';
import { toast } from '../state/toasts';
import { toastError } from './errors';
import { displayName } from './paths';

export function useShares() {
  return useQuery({ queryKey: queryKeys.shares(), queryFn: () => api.getShares(), staleTime: STALE.shares });
}

/** The note or folder the share dialog is open for. */
export const useShareDialog = create<{ path: string | null; kind: 'note' | 'folder'; open(path: string, kind: 'note' | 'folder'): void; close(): void }>()(
  (set) => ({
    path: null,
    kind: 'note',
    open: (path, kind) => set({ path, kind }),
    close: () => set({ path: null }),
  }),
);

export function openShareDialog(path: string, kind: 'note' | 'folder' = 'note'): void {
  useShareDialog.getState().open(path, kind);
}

/** The shares of one path, newest first (the server lists them so). */
export function sharesOf(shares: readonly ShareInfo[] | undefined, path: string): ShareInfo[] {
  return (shares ?? []).filter((s) => s.path === path);
}

/** A server address (`/s/...`) as a full URL of this server, to copy and send. */
export function absoluteUrl(address: string, origin: string = window.location.origin): string {
  return origin + address;
}

/** As the server checks a Tailscale login: something@something, no spaces (ShareStore.isValidLogin). */
export function isValidLogin(login: string): boolean {
  const at = login.indexOf('@');
  return login.length > 0 && login.length <= 254 && at > 0 && at < login.length - 1 && !/[\s"<>\p{Cc}]/u.test(login);
}

/** People typed into one field, separated by commas, semicolons, spaces or new lines. */
export function parseLogins(text: string): { logins: string[]; invalid: string[] } {
  const logins: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const login = part.trim();
    if (login === '') continue;
    if (!isValidLogin(login)) invalid.push(login);
    else if (!logins.some((l) => l.toLowerCase() === login.toLowerCase())) logins.push(login);
  }
  return { logins, invalid };
}

export type ExpiryChoice = 'never' | 'day' | 'week' | 'month';

export const EXPIRY_LABELS: Record<ExpiryChoice, string> = {
  never: 'Never',
  day: 'In a day',
  week: 'In a week',
  month: 'In a month',
};

const DAY_MS = 24 * 3600 * 1000;

/** When a share made now with this choice ends. */
export function expiryFor(choice: ExpiryChoice, now: number = Date.now()): IsoInstant | null {
  const days = choice === 'day' ? 1 : choice === 'week' ? 7 : choice === 'month' ? 30 : 0;
  return days === 0 ? null : new Date(now + days * DAY_MS).toISOString();
}

export const MODE_LABELS: Record<ShareMode, string> = { read: 'Can view', edit: 'Can edit' };

export const STATE_LABELS: Record<ShareState, string> = {
  active: 'Active',
  expired: 'Expired',
  missing: 'Note or folder missing',
};

function refresh(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.shares() });
}

export async function createShare(req: CreateShareRequest): Promise<ShareResult | null> {
  try {
    const result = await api.createShare(req);
    await refresh();
    toast(`Shared “${displayName(req.path)}”`);
    return result;
  } catch (e) {
    toastError(e, 'Could not share');
    return null;
  }
}

export async function updateShare(id: string, req: UpdateShareRequest): Promise<ShareResult | null> {
  try {
    const result = await api.updateShare(id, req);
    await refresh();
    return result;
  } catch (e) {
    toastError(e, 'Could not change the share');
    return null;
  }
}

/** The share's current settings, with one thing changed. */
export function settingsOf(share: ShareInfo, change: Partial<UpdateShareRequest> = {}): UpdateShareRequest {
  return { mode: share.mode, recipients: share.recipients, link: 'keep', expiresAt: share.expiresAt, ...change };
}

/** Asks first: whoever uses the share loses it at once. */
export async function revokeShare(share: ShareInfo): Promise<boolean> {
  const ok = await confirmAction({
    title: 'Stop sharing',
    message: `“${displayName(share.path)}” will no longer be shared${share.recipients.length ? ' with ' + share.recipients.join(', ') : ''}${share.hasLink ? ', and its link stops working' : ''}. The ${share.kind} itself is not changed.`,
    confirmLabel: 'Stop sharing',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.revokeShare(share.id);
    await refresh();
    toast('Stopped sharing');
    return true;
  } catch (e) {
    toastError(e, 'Could not stop sharing');
    return false;
  }
}

export async function copyAddress(address: string, what = 'Address'): Promise<void> {
  try {
    await navigator.clipboard.writeText(absoluteUrl(address));
    toast(`${what} copied`);
  } catch {
    toast('The browser refused clipboard access', { kind: 'error' });
  }
}
