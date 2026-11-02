// Shares in the in-memory mock (API.md §42): enough for the owner's share dialog and Settings ›
// Sharing. The mock has no guests, so links are made and listed but nothing ever opens them.
import type { CreateShareRequest, ShareInfo, ShareKind, ShareResult, SharesResponse, UpdateShareRequest } from '../types';
import { fail } from './problems';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function random(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** As the server checks a Tailscale login (ShareStore.isValidLogin). */
function validLogin(login: string): boolean {
  const at = login.indexOf('@');
  return login.length > 0 && login.length <= 254 && at > 0 && at < login.length - 1 && !/[\s"<>\p{Cc}]/u.test(login);
}

function recipients(raw: string[] | undefined): string[] {
  const out: string[] = [];
  for (const entry of raw ?? []) {
    const login = entry.trim();
    if (!validLogin(login)) fail('bad-request', `A person is named by their Tailscale login: ${login}`, { errors: [] });
    if (!out.some((r) => r.toLowerCase() === login.toLowerCase())) out.push(login);
  }
  if (out.length > 20) fail('bad-request', 'At most 20 people per share', { errors: [] });
  return out;
}

export class MockShares {
  private shares: ShareInfo[] = [];
  private readonly kindOf: (path: string) => ShareKind | null;

  constructor(kindOf: (path: string) => ShareKind | null) {
    this.kindOf = kindOf;
  }

  list(): SharesResponse {
    return { available: true, reason: null, shares: [...this.shares].reverse() };
  }

  create(req: CreateShareRequest): ShareResult {
    const kind = this.kindOf(req.path);
    if (!kind) fail('not-found', 'No such note or folder', { path: req.path });
    if (req.mode !== 'read' && req.mode !== 'edit') fail('bad-request', 'mode must be read or edit', { errors: [] });
    const people = recipients(req.recipients);
    if (people.length === 0 && !req.link) fail('bad-request', 'Name at least one person or make a link', { errors: [] });
    const now = new Date().toISOString();
    const id = random(12, ID_ALPHABET);
    const token = req.link ? random(43, TOKEN_ALPHABET) : null;
    const share: ShareInfo = {
      id,
      path: req.path,
      kind,
      mode: req.mode,
      recipients: people,
      hasLink: token !== null,
      linkCreatedAt: token ? now : null,
      expiresAt: req.expiresAt ?? null,
      createdAt: now,
      createdBy: 'owner@notes',
      state: 'active',
      url: `/s/${id}`,
    };
    this.shares.push(share);
    return { share, link: token ? `/s/${token}` : null };
  }

  update(id: string, req: UpdateShareRequest): ShareResult {
    const current = this.shares.find((s) => s.id === id);
    if (!current) fail('not-found', 'No such share');
    const people = recipients(req.recipients);
    const token = req.link === 'new' ? random(43, TOKEN_ALPHABET) : null;
    const hasLink = req.link === 'new' || (req.link === 'keep' && current.hasLink);
    if (people.length === 0 && !hasLink) fail('bad-request', 'Name at least one person or keep a link', { errors: [] });
    const updated: ShareInfo = {
      ...current,
      mode: req.mode,
      recipients: people,
      hasLink,
      linkCreatedAt: token ? new Date().toISOString() : hasLink ? current.linkCreatedAt : null,
      expiresAt: req.expiresAt,
    };
    this.shares = this.shares.map((s) => (s.id === id ? updated : s));
    return { share: updated, link: token ? `/s/${token}` : null };
  }

  revoke(id: string): void {
    if (!this.shares.some((s) => s.id === id)) fail('not-found', 'No such share');
    this.shares = this.shares.filter((s) => s.id !== id);
  }
}
