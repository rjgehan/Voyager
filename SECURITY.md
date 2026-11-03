# Security policy

Voyager is a self-hosted, single-owner notes server: your notes never leave your server unless you turn on a feature that sends them somewhere (the history mirror, Ask your vault, publishing). How it is protected, what it trusts in each way of deploying it, and the risks that remain are written down in [docs/SECURITY.md](docs/SECURITY.md). Read its *Hardening advice* before exposing an instance; in particular, the CasaOS layout that publishes port `18095` needs the firewall rule described there.

## Supported versions

Only the current `main` branch is supported: the `latest` image on GHCR (`ghcr.io/rjgehan/notesapp`), the web app and installed PWA it serves, and the desktop app and web clipper built from `main`. Fixes are not backported. With Watchtower (the shipped compose files), a fix reaches your server within minutes of being merged.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub: the repository's **Security** tab → **Report a vulnerability** (private vulnerability reporting). If that button is not available, open an issue that only asks for a private way to report a security problem, with no details in it.

A useful report has:

- the version: the build SHA shown on the status page (or the `X-Notes-Build` response header), or the commit you built;
- how the instance is deployed: the main Compose layout (docs/DEPLOY.md), the CasaOS layout with Tailscale on the host, or the CasaOS sidecar layout (docs/CASAOS.md), and which optional features are on (publishing, AI, mirror, multiple vaults);
- the steps to reproduce, and what an attacker gains: who the attacker has to be (a website you visit, a note or file you open, a device on your LAN or tailnet, anyone on the internet);
- no real note content, tokens or tailnet names: a scratch vault is enough.

This is a personal project maintained in spare time. You can expect an acknowledgement within a week, an assessment soon after, and a fix as fast as its severity calls for; you will be told when it is merged, and credited in the advisory if you wish.

## Scope

In scope: the backend (the API, the event stream, raw file serving, the publish server), the web app and its service worker, the desktop app, the web clipper (extension and bookmarklet), and the deployment files in `deploy/`.

Out of scope:

- Tailscale, Docker, CasaOS and other software Voyager runs on, unless Voyager uses or configures them insecurely;
- attacks that need root on the server or control of the owner's device;
- the residual risks that docs/SECURITY.md documents with their mitigation (for example a LAN device reaching port `18095` of the older CasaOS bridge variant without the firewall rule), unless you found a way around the mitigation;
- denial of service by the owner against their own instance, and findings from automated scanners without a demonstrated impact.

Please test only against an instance you run yourself.
