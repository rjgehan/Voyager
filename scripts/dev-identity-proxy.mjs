#!/usr/bin/env node
// A stand-in for `tailscale serve` while developing sharing with family (ROADMAP item 43, DESIGN
// §5.40): it listens on loopback, deletes any client-supplied Tailscale-* headers and sets
// Tailscale-User-Login (and -Name) to the identity it was started with, then forwards to the dev
// backend, keeping the Host header (so the backend's Host and Origin checks see the browser's
// address). Open the app through one proxy per identity to try owner and guest side by side.
//
// It is a development tool only: nothing in the app trusts it or knows about it, it is not part of
// the image (the Dockerfile copies frontend/ and backend/), and the backend accepts identity headers
// from anyone who can reach its port only because the dev profile binds 127.0.0.1 and production
// sits behind `tailscale serve`, which replaces them (DESIGN §2.4).
//
//   node scripts/dev-identity-proxy.mjs --listen 18621 --target 18620 --login mom@example.com --name "Mom"
//
// Then add localhost:18621 to the backend's notes.allowed-hosts.
import http from 'node:http';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const listen = Number(arg('listen', '18621'));
const target = Number(arg('target', '18620'));
const login = arg('login', '');
const name = arg('name', login);

if (!Number.isInteger(listen) || !Number.isInteger(target) || !login.includes('@')) {
  console.error('usage: node scripts/dev-identity-proxy.mjs --listen <port> --target <backend port> --login <name@example.com> [--name <display name>]');
  process.exit(2);
}

/** RFC 2047 Q-encoding for a non-ASCII display name, as `tailscale serve` sends it. */
function encodeName(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = Buffer.from(value, 'utf8');
  let out = '';
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9]/.test(c) ? c : '=' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return `=?utf-8?q?${out}?=`;
}

const server = http.createServer((req, res) => {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!key.toLowerCase().startsWith('tailscale-')) headers[key] = value;
  }
  headers['tailscale-user-login'] = login;
  headers['tailscale-user-name'] = encodeName(name);
  const upstream = http.request({ host: '127.0.0.1', port: target, method: req.method, path: req.url, headers }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`proxy: ${e.message}`);
  });
  req.pipe(upstream);
});

server.listen(listen, '127.0.0.1', () => {
  console.log(`dev identity proxy: http://localhost:${listen} -> 127.0.0.1:${target} as ${login}`);
});
