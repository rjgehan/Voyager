# NotesApp: threat model and security audit

This is the security view of NotesApp: what it protects, from whom, where the trust boundaries are in each way of running it, and which control holds each boundary. It also records the adversarial audit of 2026-11-02 (findings, fixes, and the risks that remain) and the hardening advice that follows from it. [DESIGN.md](DESIGN.md) §2.4, §5.3, §5.13 and §5.14 are the design of the controls; this document does not repeat their details. How to report a vulnerability: [SECURITY.md](../SECURITY.md) at the repository root.

## 1. What is protected

| Asset | Where it lives | Why it matters |
|---|---|---|
| **The vault**: notes, attachments, settings, tasks, bookmarks, flashcard records | `/data/vault` (and `/data/vaults/<name>` for extra vaults) | Private by nature: journals, passwords people paste into notes, work notes. Read access is the main prize; write access lets an attacker plant content (or scripts, §4.8) that the owner later opens. |
| **History** | `/data/vault/.git` | Every version of every note, including text the owner deleted. Restoring it is how an attack is undone, so its integrity matters too. |
| **Secrets** | `/data/secrets` (mode 700): the Claude Code OAuth token or Anthropic API key, `ntfy.json`, `push.json` (the Web Push VAPID private key and the subscribed devices), the mirror token (or Compose secrets in `/run/secrets`) | Each opens something outside the app: the owner's Claude subscription or API spend, a GitHub repository holding the whole history, push notifications to the owner's phone. |
| **Published snapshots** | `/data/publish` | Public by intent, but only what the owner published, as it was when published. |
| **The owner's devices** | Browsers (iPhone PWA, Windows), the desktop app, the clipper extension | Content rendered there must not run code, load from other sites by itself, or impersonate the app. Their offline caches hold note text. |
| **Availability** | The one server | A crash loop or a full disk takes the notes away from every device at once. |

There is **no app login**. Admission is Tailscale identity (the `Tailscale-User-*` headers that `tailscale serve` sets) checked against `notes.identity.allowed-logins`. Every admitted identity has full read and write access to every vault: there are no per-user permissions.

## 2. Who might attack

| | Attacker | Realistic goal |
|---|---|---|
| A1 | Anyone on the internet | Reach the app through Funnel or a misconfiguration; abuse the public publish server. |
| A2 | A device on the server's **LAN** (guest Wi-Fi, a compromised IoT device) | Talk to a published container port directly and forge identity headers. |
| A3 | A **tailnet peer that is not the owner**: a tagged device, a user the node is shared with, another member when the allowlist is empty | Use the app as if it were the owner. |
| A4 | **Content**: a web page that is clipped or pasted, an imported Obsidian vault, a downloaded PDF or SVG, a shared note, a prompt-injected AI answer | Run code in the app's origin, exfiltrate notes (to a remote image URL, for instance), draw a fake UI, crash the server. **The most realistic attacker**: the owner brings the content in themselves. |
| A5 | A **website the owner visits** while the app is open | CSRF, DNS rebinding, reading API responses cross-origin, opening `/clip` with prepared content. |
| A6 | A **compromised dependency** or other code running next to the app | Reach the tailnet or the LAN from the server; read secrets. |
| A7 | **Other containers or processes on the host** | Reach the app's port without going through `tailscale serve`. |

Out of scope: an attacker with root on the server or on one of the owner's devices, and Tailscale itself being broken.

## 3. Deployment layouts and their trust boundaries

The app trusts the `Tailscale-User-Login` header absolutely. **Whatever can open a TCP connection to the app's HTTP port can therefore be anyone it likes.** Each layout is safe exactly as far as it limits who can open that connection.

### 3.1 Main layout (`deploy/docker-compose.yml`, DEPLOY.md)

The app shares the network namespace of a kernel-mode `tailscale` container and listens on `127.0.0.1:8080` only. `tailscale serve` (in the same namespace) terminates TLS on `:443`, deletes client-supplied `Tailscale-User-*` headers and sets the real ones. Nothing outside the namespace can connect to `127.0.0.1:8080`; tailnet packets for `100.x.y.z:8080` find no listener (kernel mode). The app refuses to start when it sees no kernel Tailscale interface (`TailscaleInterfaceCheck`), so a dropped `TS_USERSPACE: "false"` cannot silently forward every tailnet port to loopback. `NOTES_IDENTITY_ALLOWED_LOGINS` is mandatory here. **Identity headers cannot be forged** in this layout.

### 3.2 CasaOS simple layout (`deploy/casaos-compose.yml`, CASAOS.md): the weakest

Tailscale runs on the **host**; `tailscale serve --https=8443 http://127.0.0.1:18095` proxies to the container's published port. CasaOS accepts only a bare port, so Docker publishes `18095` on **every interface of the host**, IPv4 and IPv6, and the app listens on `0.0.0.0` inside the container. Consequences:

- **A2 can forge identity.** Any device on the LAN can send `Host: homeserver.<tailnet>.ts.net` and `Tailscale-User-Login: <any or the owner's login>` to `http://<server-ip>:18095` and is admitted with full access. The tailnet name is public (certificate transparency logs list `*.ts.net` certificates), and with `NOTES_IDENTITY_ALLOWED_LOGINS` unset (the CasaOS default) any login works. The Host allowlist and the identity check stop browsers, not programs.
- **A3 can forge identity too**, through the host's tailnet address (`100.x.y.z:18095`), unless the tailnet policy blocks that port.
- **A7**: other containers on the compose network reach `notesapp:8080` directly.
- A source-address check in the app cannot close this. Connections that `tailscale serve` makes to `127.0.0.1:18095` reach the container through Docker's userland proxy and arrive from the bridge gateway, and so do connections from the LAN to the host's **IPv6** addresses (link-local ones included), which the same proxy forwards to the IPv4-only container. The two are indistinguishable inside the container.

The fix is at the network level: §7.1. Until it is applied, treat this layout as **"anyone on the LAN can read and change the vault"**.

### 3.3 CasaOS sidecar layout (`deploy/casaos-compose-sidecar.yml`)

A `tailscale` container and the app share a private Compose network (`notes-internal`); the app publishes no port and listens on `0.0.0.0` inside that network, and `tailscale serve` proxies to `http://notesapp:8080`. Only containers on `notes-internal` (the tailscale container) can connect. Identity headers cannot be forged from the LAN or the tailnet. The Tailscale interface check is off (Tailscale is in another container), so the kernel-mode guarantee rests on `TS_USERSPACE: "false"` in the compose file.

### 3.4 Public publishing through Funnel (DESIGN §5.28)

Off unless `NOTES_PUBLISH_ENABLED=true` **and** the tailnet policy grants `funnel` **and** serve has an `AllowFunnel` entry. Even then Funnel reaches only the **publish server**, a separate JDK `HttpServer` (`127.0.0.1:8081`) that answers `GET`/`HEAD` for `/p/<slug>`, `/p/<slug>/<asset>` and `/p/-/style.css`, matched on the raw path, from snapshots written to `/data/publish` (outside the vault) at publish time. No controller, filter, API route or vault file is reachable on it. Every response carries `default-src 'none'` (no script can run), `X-Robots-Tag: noindex`, and `sandbox` on assets. The app on `:443`/`18095` refuses any request carrying `Tailscale-Funnel-Request` (`403 funnel-request`), health endpoints included. A snapshot leaves out frontmatter, `%% %%` and `<!-- -->` comments, raw HTML, encrypted sections, query blocks and embeds of unpublished notes.

### 3.5 The browser (the SPA, raw files, the service worker)

- **Admission and CSRF** (DESIGN §5.13, §5.14): Host allowlist (`421`, blocks DNS rebinding), identity allowlist (`403`), and on every mutating `/api/**` request a well-formed `X-Client-Id` (a custom header, so a cross-origin request needs a CORS preflight, which fails: there is no CORS configuration), an `Origin` equal to the `Host` when present, and a same-origin `Sec-Fetch-Site` when present. JSON endpoints accept only `application/json`; uploads accept any type but need the header too. `GET` never has side effects. `/capture/share` (the PWA share target) accepts a form `POST` but only redirects.
- **CSP** on every page: `script-src 'self' 'wasm-unsafe-eval'`, no inline script, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `connect-src 'self'`. `img-src` and `media-src` allow `https:`, because Obsidian notes embed remote images: **the CSP does not stop a page from loading a remote image**, so "nothing loads from other sites" is the sanitizer's job (§3.5, last item).
- **Raw files** (`/api/files/raw`, history, trash): `nosniff`, a sandbox CSP, HTML, XML and JavaScript forced to `application/octet-stream` + `attachment`, SVG inline only under `sandbox`, symlinks never served.
- **Rendered note HTML** (reading pipeline, Live Preview widgets, embeds, script output, AI answers): DOMPurify plus the app's own rules: reserved attributes stripped (a note cannot forge an embed), no `position: fixed|sticky` or `z-index`, every remote load removed when remote images are off (always for script output and AI answers), and a `contain: paint` box around everything rendered so it cannot draw over the app.
- **Service worker**: same-origin only; caches the app shell and content-addressed media, never API responses.

### 3.6 The web clipper (browser extension and bookmarklet, DESIGN §6.27.1)

Neither ever calls the API (an extension origin fails the Origin check). Both hand the clip to the app's `/clip` page with `postMessage`. `/clip` accepts a message only from its own origin (the extension's content script runs in the page's window) or from its `opener` (the bookmarklet), and **saves without a click only for same-origin senders**; a clip from any other window is a preview that the owner saves with a click. `/clip` cannot be framed. The extension asks for no host permission at install, reaches the clipped tab through `activeTab`, and downloads images with `credentials: 'omit'`.

### 3.7 The desktop app (Electron, DESIGN §6.39)

Every window: `contextIsolation`, `sandbox`, no Node integration, no `<webview>`, `webSecurity` on. Navigation stays on the configured server origin; other `http(s)`/`mailto` links go to the default browser, anything else is blocked. Permissions: notifications, clipboard write, fullscreen and the microphone only, for the server's origin only. IPC messages are accepted only from the frame that may send them (the server's pages, or the shell's own `file:` pages). Plain `http` is accepted only for loopback servers. Certificate errors are not overridden.

### 3.8 Scripts in notes (DESIGN §6.43.1)

Note scripts run in QuickJS inside a dedicated worker whose own CSP forbids every network access, with CPU, memory, output and wall-time limits. The host API is read-only (no writes, no fetch). The output is data, turned into Markdown and rendered like a note **with remote loading off**, so a script that read the vault cannot send it anywhere in an image request. Scripts run as soon as the note shows (`auto`, the default), so **a note from an untrusted source is code that can read the whole vault**; only the rendering rules keep it from sending what it read away. Settings › This device › Scripts in notes can be set to *Ask before running*.

### 3.9 AI providers (DESIGN §5.25)

Off until the owner turns it on and gives a credential. A question sends the question and the text of the notes it needs (never of excluded folders, never encrypted sections) to Anthropic: **that text leaves the tailnet**. The Claude Code CLI runs with every tool disabled, an empty home and working directory, a clean environment and the token only in the environment. Answers are untrusted content (a note can prompt-inject them) and render with remote loading off.

### 3.10 Outbound connections

| Connection | Destination comes from | Note |
|---|---|---|
| Mirror push | `NOTES_MIRROR_URL` (deploy configuration) | The whole history leaves for that repository. |
| AI | Fixed (`api.anthropic.com`, or the CLI) | §3.9. |
| ntfy (alerts, reminders) | `/data/secrets/ntfy.json` | A token is sent only over https, or http to a loopback or tailnet host. |
| Transcription | `NOTES_TRANSCRIPTION_URL` | Normally a sidecar on the Compose network. |
| **Web Push** | **The browser that subscribed** (`POST /api/push/subscriptions`) | The only destination an API caller chooses: https only, no redirects, and (since this audit) no loopback, private, link-local or tailnet address. |

The tailnet policy of DEPLOY.md step 6 gives `tag:notes` no outgoing grant, so code on the server cannot reach the owner's devices over the tailnet. It does not restrict the LAN or the internet.

### 3.11 Multiple vaults (DESIGN §5.39)

Each extra vault is its own Spring context behind `/api/v/<name>/`; the prefix is rewritten before every filter runs, so admission, size limits, the CSRF guard and the security headers apply unchanged. Only a literal, well-formed prefix routes (no escapes, `;` parameters or dot segments). All vaults share one identity allowlist: **an admitted identity can use every vault**.

## 4. Controls by boundary

| Boundary | Attackers | Controls |
|---|---|---|
| Network → app port | A1, A2, A3, A7 | Layout (§3): loopback-only listener or private Compose network; kernel-mode Tailscale check; **the CasaOS simple layout needs §7.1**. |
| `tailscale serve` → app | A3 | Identity allowlist (`NOTES_IDENTITY_ALLOWED_LOGINS`); Host allowlist; Funnel requests refused. |
| Browser → API | A5 | Custom-header CSRF guard, Origin and `Sec-Fetch-Site` checks, no CORS, JSON-only bodies, side-effect-free `GET`. |
| API → disk | A3, A5 | `VaultPaths` (§5.3): NFC, no `.`/`..`, no hidden segments (`.git`, `.notesapp`, `.trash` → `403`), Windows name rules, symlink and junction escape checks, `NOFOLLOW_LINKS` everywhere. |
| Content → browser | A4 | CSP, raw-file sandboxing, DOMPurify + app rules, containment, remote-load blocking, script sandbox. |
| Content → server | A4 | Size limits (16 MB JSON, 100 MB uploads, 5 MB text), search regex timeout and concurrency limit, YAML alias and size limits, Jackson nesting limits, PDF size, page, time and crash limits (§5). |
| Server → elsewhere | A6 | Tailnet policy with no grant from `tag:notes`; Web Push destinations limited to public addresses; secrets readable by uid 1000 only. |
| Internet → published pages | A1 | Separate server, raw-path matching, snapshots outside the vault, no-script CSP. |

## 5. Audit of 2026-11-02

_Findings, reproductions and fixes: added as the fixes land (section 5 of this file on branch `fix/security-audit`)._

## 6. Residual risks

_See section 7 for what to do about them; listed as the audit completes._

## 7. Hardening advice

### 7.1 Close port 18095 to everything but the host (CasaOS simple layout)

Apply both rules (IPv4 **and** IPv6: Docker's userland proxy also listens on the host's IPv6 addresses, link-local included):

```sh
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 18095 --ctdir ORIGINAL -j DROP
sudo ip6tables -I INPUT -p tcp --dport 18095 -j DROP
curl -sI http://127.0.0.1:18095 | head -1        # on the host: still answers (421)
```

and make them survive reboots (`sudo apt install iptables-persistent && sudo netfilter-persistent save` on Debian and Ubuntu). From another machine, `curl -m 5 http://<server-ip>:18095` must time out, and so must `curl -m 5 -g 'http://[<server-ipv6>]:18095'`. CASAOS.md *Who can reach port 18095* has the details. The sidecar layout (§3.3) needs none of this.

### 7.2 Name the allowed logins

Set `NOTES_IDENTITY_ALLOWED_LOGINS` to your own Tailscale login(s) in every layout. Without it, every identity `tailscale serve` passes on (any member of the tailnet, and users the node is shared with) has full access. The app logs a warning at startup when the list is empty.

### 7.3 Tailnet policy

Apply DEPLOY.md step 6: `tag:notes` gets no outgoing grant, and your devices reach it on the HTTPS port only. In the CasaOS simple layout, also make sure no grant lets tailnet peers reach the host's port `18095` (only the serve port, `8443`).

### 7.4 Secrets

`/data/secrets` mode 700, each file mode 600, owned by uid 1000 (the app creates `push.json` that way itself). Give the mirror token access to the one mirror repository only (a fine-grained token with *Contents: read and write* on that repository). Rotate the Claude token or API key if `/data` is ever copied somewhere less trusted (a backup disk included: the restic repository is encrypted, a plain copy is not).

### 7.5 Content you did not write

Scripts run as soon as a note shows. Before importing a vault or pasting notes from someone else, set *Settings › This device › Scripts in notes* to *Ask before running*, and review `script` and `dataview` blocks before running them. Keep *Load remote images* off if you clip pages often: a clipped page's images otherwise tell its site when you read the note.

### 7.6 Publishing

Everything published is public, indexed or not. Review a note before publishing it; republishing is needed for an edit to appear, and unpublishing deletes the snapshot.
