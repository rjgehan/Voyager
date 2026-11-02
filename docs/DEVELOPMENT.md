# Developing NotesApp

How to run, test and change NotesApp locally, how the repository is laid out, and how a change reaches the server. The design is in [DESIGN.md](DESIGN.md) and the API contract in [API.md](API.md).

## Repository layout

| Path | What |
|---|---|
| `backend/` | Spring Boot app (`com.rjgehan.notes`), Maven wrapper |
| `frontend/` | React + TypeScript + Vite SPA |
| `clipper/` | The web clipper: browser extension, bookmarklet and iOS Shortcut script ([docs/CLIPPER.md](CLIPPER.md)) |
| `deploy/` | `docker-compose.yml` (tailscale, notes, watchtower; optional backup sidecars), the backup scripts in `backup/`, the empty mirror-token placeholder in `mirror/`, Tailscale serve config, `.env.example`, and for CasaOS `casaos-compose.yml` (the app on the host's Tailscale), the advanced `casaos-compose-sidecar.yml` and the optional `casaos-backup-compose.yml` and `casaos-whisper-compose.yml` |
| `desktop/` | The Electron desktop app for Windows and macOS ([DESKTOP.md](DESKTOP.md)) |
| `.github/` | CI, image publishing, the GitHub Pages demo, Dependabot |
| `Dockerfile` | Three stages: frontend build, backend build (JDK 21), JDK 25 runtime with an AOT cache |
| `docs/` | Design, API contract, deployment runbooks, roadmap, feature list, screenshots (`images/`) |
| `scripts/` | `third-party-notices.mjs`, which regenerates `THIRD_PARTY_NOTICES.md` |

## Local development (Windows)

Needs JDK 21 and Node 24 (npm 11). Docker is not needed. Run the two halves in separate terminals:

```powershell
# Backend on http://127.0.0.1:8080. The dev profile uses .\dev-vault (created on first start,
# gitignored), needs no Tailscale and acts as a default "Owner" identity.
cd backend
.\mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=dev"
```

```powershell
# Frontend on http://localhost:5173. Vite proxies /api (REST and SSE) to the backend.
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

- **Another vault:** set `$env:NOTES_VAULT_DIR = "C:\path\to\a\copy"` before starting the backend. Point it at a copy, never at a vault you care about.
- **Frontend without a backend:** `$env:VITE_MOCK_API = "1"; npm run dev` uses the in-memory mock API (a small vault in the page, with tasks, flashcards, habits and the calendar answered by `api/mock/server.ts`).
- **The live demo locally:** `npm run build:demo`, then `npm run preview:demo` and open <http://localhost:4173/notesapp/>. It is the GitHub Pages build (DESIGN §6.46): the mock API with the showcase vault, under the `/notesapp/` base path.
- **Ports 8080 or 5173 taken:** start the backend with `"-Dspring-boot.run.arguments=--server.port=18080 --notes.allowed-hosts=localhost:5180,127.0.0.1:5180"`, then the frontend with `$env:NOTES_DEV_BACKEND = "http://127.0.0.1:18080"; npm run dev -- --port 5180 --strictPort`. The allowed hosts must name the Vite origin, because the proxy keeps the browser's `Host`.
- **Phone against dev:** possible over the tailnet, but read [DESIGN §9.1](DESIGN.md#91-integration-step-after-all-three-work-packages) step 4 first; never bind Vite to `0.0.0.0`.

Checks (the same ones CI runs):

```powershell
cd backend;  .\mvnw.cmd verify                      # add "-DexcludedGroups=" to include the perf tests
cd frontend; npx tsc -b; npm run lint; npm test; npm run build; npx vite build --mode demo
cd clipper;  npm test                              # and desktop: npm test
```

`npm test` includes the accessibility checks that need no browser (axe-core on the app shell, and the theme colours' contrast). The full audit runs axe-core in an installed Chrome or Edge on every screen, both themes, desktop and phone: `cd frontend; npm run test:a11y` (not in CI; see [ACCESSIBILITY.md](ACCESSIBILITY.md)).

## How a change reaches the server

1. **Pull requests** run the backend tests, the frontend lint, tests and build, and a Docker image build (amd64, not pushed), so the Dockerfile is exercised before anything reaches `main`.
2. **A push to `main`** (docs-only pushes excepted) runs the same checks and then [`publish.yml`](../.github/workflows/publish.yml), which builds `linux/amd64` and `linux/arm64` images and pushes `ghcr.io/rjgehan/notesapp:latest` and `:sha-<7 hex>` to the GitHub Container Registry (GHCR).
3. **Watchtower** on the server polls GHCR every 5 minutes, pulls the new image and recreates the `notes` container with a 45 s graceful stop. Open browser tabs reconnect and reload themselves onto the new build.
4. **The live demo** ([`pages.yml`](../.github/workflows/pages.yml)) is rebuilt and deployed to GitHub Pages on pushes to `main` that touch `frontend/`.
5. **Weekly**, a scheduled run rebuilds and republishes the image so base-image security fixes arrive without a code change. Dependabot proposes grouped dependency updates weekly.

Rolling back, pausing updates, backups and everything else on the server side are in [docs/DEPLOY.md](DEPLOY.md).

## Conventions

- [API.md](API.md) §17 stays byte-identical to `frontend/src/api/types.ts` (a test compares them).
- The frontend's initial JavaScript must stay under 350 KiB gzipped (the build fails otherwise, DESIGN §6.1.1): new UI goes into lazy chunks.
- App CSS uses no `rem` (a test checks it): the root keeps the browser's 16 px for Excalidraw.
- Vault data stays plain files (or `.notesapp/…`); secrets live only under `/data/secrets`, never in the repository.
- New dependencies need a licence compatible with GPL-3.0 and an exact version; after changing them, run `node scripts/third-party-notices.mjs` from the repository root.
