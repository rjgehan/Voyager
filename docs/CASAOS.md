# Installing NotesApp on CasaOS

This is the short path for a CasaOS server that already runs Tailscale on the host: one compose file pasted into the CasaOS UI, two commands over SSH, no `.env`. [DEPLOY.md](DEPLOY.md) is the full runbook (plain Docker Compose, backups, rollback, troubleshooting); what it says about Watchtower and the app applies here too. The optional extras further down (app alerts, the GitHub mirror, voice note transcription, Ask your vault with Claude, nightly backups, public publishing) are off until you set them up, and a fresh install needs none of them.

The file is [`deploy/casaos-compose.yml`](../deploy/casaos-compose.yml). It runs two containers:

| Container | Job |
|---|---|
| `notesapp` | The app. It shares the host's network (`network_mode: host`) and listens on the host's loopback only, `127.0.0.1:18095`, so nothing on the LAN or the tailnet can connect to it (see *Who can reach port 18095* below) |
| `notesapp-watchtower` | Checks GHCR every 5 minutes and restarts `notesapp` when a new image is pushed to `main` |

The **host's own Tailscale** gives the HTTPS address and your login: `tailscale serve` on the host proxies `https://homeserver.<tailnet>.ts.net:8443` to `127.0.0.1:18095` and adds the Tailscale identity headers the app requires. (`homeserver` stands for the host's machine name in your tailnet; `8443` because the host already serves another app on 443. If nothing else uses 443, serve on 443 and drop `:8443` everywhere below.)

Data lives in `/DATA/AppData/notesapp/data/`: `vault/` holds your notes and their git history. `secrets/` (the alert and mirror settings, the Claude token or Anthropic API key), `../whisper/` (the transcription model) and `../backup/` appear only if you set up the extras below.

An older layout with its own Tailscale container is kept as an appendix (*Advanced: own Tailscale container*); CasaOS cannot run it as it stands.

## 1. Before installing (once)

1. **Tailscale on the host**, logged in to your tailnet, with **MagicDNS** and **HTTPS Certificates** on (admin console → **DNS**). `tailscale status` shows the host's name; `tailscale cert` would issue its certificate. Note the full name, e.g. `homeserver.tail1234.ts.net`.
2. **The data folder**, owned by the app's user (uid 1000), over SSH or in CasaOS's terminal:
   ```sh
   sudo mkdir -p /DATA/AppData/notesapp/data && sudo chown -R 1000:1000 /DATA/AppData/notesapp/data
   ```
   Without it Docker creates the folder as root and the app cannot write its vault.
3. **The image** `ghcr.io/rjgehan/notesapp` is a **public** GHCR package, so no `docker login` is needed. (If you build your own image with the Claude Code CLI inside, for *Ask your vault*, keep that package **private**: Claude Code is Anthropic's proprietary software. Then run `docker login ghcr.io -u <you>` once on the server with a classic token that has only `read:packages`, and uncomment `REPO_USER` / `REPO_PASS` in the `watchtower` service.)

## 2. Install

1. In the compose file, replace `homeserver.<tailnet>.ts.net` (twice, in `NOTES_ALLOWED_HOSTS`) with the host's name from step 1.1, and `you@example.com` in `NOTES_IDENTITY_ALLOWED_LOGINS` with your Tailscale login (the email shown in the admin console; comma-separate several). The login is required: the logins listed there are the vault's owners, the only ones let in to the app, and the placeholder lets nobody in. A login outside the list only ever sees what you share with it (*Sharing with family* below). Set `TZ` if you are not on New York time.
2. CasaOS → **App Store → Custom Install** (the `+` at the top right) → **Import** → paste the file → **Submit**, then **Install**. The CasaOS tile turns green within a minute.
3. **HTTPS on the tailnet**, once over SSH (it survives reboots):
   ```sh
   sudo tailscale serve --bg --https=8443 http://127.0.0.1:18095
   tailscale serve status        # https://homeserver.<tailnet>.ts.net:8443 → http://127.0.0.1:18095
   ```
4. Open `https://homeserver.<tailnet>.ts.net:8443` on any tailnet device, including the iPhone (Safari → Share → Add to Home Screen for an app icon). The first visit can take ~30 s while the certificate is issued.

### Who can reach port 18095

Only the host. The app shares the host's network and listens on `127.0.0.1:18095`, the host's loopback, so no device on the LAN or the tailnet can open a connection to it; `tailscale serve` runs on the host, connects there and adds the Tailscale identity headers. On top of that the app answers only requests whose `Host` is in `NOTES_ALLOWED_HOSTS` and that carry those headers: a login listed in `NOTES_IDENTITY_ALLOWED_LOGINS` gets the app, any other login only the guest page of what is shared with it (*Sharing with family*), and anything else gets `421` or `403`. No firewall rule is needed. To check from another machine on the LAN: `curl -m 5 http://<server-ip>:18095` is refused at once (and so is the host's tailnet address, `100.x.y.z:18095`). Programs running on the host itself can still reach the port, as they can reach the data folder.

**If you keep the older bridge layout** (`ports: - "18095:8080"` with `SERVER_ADDRESS: 0.0.0.0`, the CasaOS file before November 2026, or because host networking does not suit your host): Docker then publishes the port on every interface of the host, IPv4 and IPv6, and a program on the LAN (or on the host's tailnet address) can send the identity headers itself: **any device on the LAN, a guest's phone or a smart plug included, can then read and change every note**. The app cannot tell such a connection from `tailscale serve`'s (both reach the container through Docker's proxy; docs/SECURITY.md §3.2 explains why), and `NOTES_IDENTITY_ALLOWED_LOGINS` only makes the attacker guess your login. In that layout, drop every connection to the port that does not come from the host itself (`tailscale serve` connects from the host, so it keeps working):

```sh
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 18095 --ctdir ORIGINAL -j DROP
sudo ip6tables -I INPUT -p tcp --dport 18095 -j DROP     # Docker's proxy also listens on IPv6
curl -sI http://127.0.0.1:18095 | head -1                # on the host: still answers (421 without a Host it knows)
```

`DOCKER-USER` is the chain Docker leaves for your own rules; the rule matches connections forwarded to the container that were addressed to port 18095, which is every connection from another machine. The rules last until the next reboot: save them with your distribution's tool (on Debian or Ubuntu `sudo apt install iptables-persistent`, then `sudo netfilter-persistent save`), or put the two commands in a boot-time script. To check from another machine on the LAN: `curl -m 5 http://<server-ip>:18095` now times out, and so does `curl -m 5 -g 'http://[<server-ipv6>]:18095'` for each IPv6 address of the server, its link-local `fe80::` one included, which every LAN neighbour can reach (written `[fe80::…%25eth0]`, with the interface of the machine you test from).

## Import an Obsidian vault

Do this right after installing, before you write notes in NotesApp: a vault whose data folder has no settings yet takes its settings from Obsidian's `.obsidian/` folder at its first start (attachment folder, new notes, link format, excluded files, daily notes, templates, …; ROADMAP item 24). `.obsidian/` is read but never changed, so the vault keeps working in Obsidian. DEPLOY.md *Import an Obsidian vault* has the details.

1. **Copy the vault to the server.** Close Obsidian (or let its sync finish), then from your PC, for example: `scp -r "C:\Users\<you>\Documents\MyVault" <you>@<server>:/tmp/MyVault`. Without SSH, zip the vault, upload it with CasaOS's **Files** app to `/DATA`, and unzip it there (Files → right-click → Extract); an iCloud vault must be fully downloaded on the PC first.
2. **Swap it in**, in CasaOS's terminal or over SSH (the app's data folder must contain only the empty vault NotesApp created, with at most its `Welcome.md`):
   ```sh
   docker stop notesapp
   sudo mv /DATA/AppData/notesapp/data/vault /DATA/AppData/notesapp/data/vault.empty
   sudo mkdir /DATA/AppData/notesapp/data/vault
   sudo cp -a /tmp/MyVault/. /DATA/AppData/notesapp/data/vault/
   sudo chown -R 1000:1000 /DATA/AppData/notesapp/data/vault
   docker start notesapp
   ```
   The app is ready at once and records the import in its history in the background. Once the notes show up, delete `vault.empty` (and `/tmp/MyVault`).
3. **Check `https://homeserver.<tailnet>.ts.net:8443/x/compat`**, the *Compatibility report* (also in the drawer and Settings › About): every Obsidian setting should be *In effect*. It lists the plugins the vault used and what NotesApp offers instead, and everything that does not carry over (Dataview queries, Templater commands, links to missing files or headings, …), each opening the note at its line. **Use them on this device** takes Obsidian's graph colors and forces for the graph view, once per device.

If the vault has its own `.git` (the obsidian-git plugin), it is kept and NotesApp commits to it; turn the plugin off in Obsidian. Into an installation that already has notes, copy the vault into a subfolder instead and leave out its `.obsidian` and `.git` (DEPLOY.md).

## Updating

Push to `main`. CI builds and publishes the image, and Watchtower restarts `notesapp` within about 5 minutes. Tailscale is the host's, updated with the host; to update Watchtower, use the CasaOS app's **Update** or **Rebuild**.

**Status page.** `https://homeserver.<tailnet>.ts.net:8443/x/status` (also in the drawer and the command palette) shows problems first, then the version, the Java runtime, history, disk space, the last backup and the alerts.

## Optional extras

Each is off until you set it up, and each is the CasaOS form of a section of [DEPLOY.md](DEPLOY.md), which has the background. To change an environment variable of the app: CasaOS → NotesApp → **Settings**, the `notes` container, edit the variable, **Save** (CasaOS recreates the container). The files below go in `/DATA/AppData/notesapp/data/secrets/`, next to the vault but never inside it, so they never reach git, the trash or the mirror. The nightly backups copy them, encrypted.

```sh
sudo install -d -o 1000 -g 1000 -m 700 /DATA/AppData/notesapp/data/secrets   # once; uid 1000 is the app's user
```

### App alerts (ntfy)

The app pushes its own problems (history not saved, the mirror failing, the disk filling up, …) to an [ntfy](https://ntfy.sh) topic, without paths or note content (DEPLOY.md *App alerts*). Pick a topic (`notes-` plus `openssl rand -hex 16`), subscribe to it in the ntfy app on the phone, then:

```sh
sudo -u '#1000' sh -c 'umask 077 && cat > /DATA/AppData/notesapp/data/secrets/ntfy.json' <<'EOF'
{ "server": "https://ntfy.sh", "topic": "notes-<hex>" }
EOF
```

No restart is needed. On the status page, *App alerts* then says "sent to ntfy at https://ntfy.sh"; press **Send a test alert**.

### Reminders (Web Push, ntfy, in the app)

Task reminders (set in a task's details) and an optional daily-note nudge (DEPLOY.md *Reminders*). Every way of delivering them is **off until you switch it on** in NotesApp's **Settings › Reminders**; nothing needs to change in CasaOS for Web Push or in-app reminders.

- **Web Push to the iPhone** (iOS 16.4 or later): open `https://homeserver.<tailnet>.ts.net:8443` in Safari, **Share › Add to Home Screen**, open NotesApp from the Home Screen icon, then **Settings › Reminders › Subscribe this device** and allow notifications. Switch on **Send by Web Push** and press **Send a test** next to the device. The app creates its push key in `/DATA/AppData/notesapp/data/secrets/push.json` on first use. Desktop Chrome, Edge and Firefox subscribe the same way, from a tab.
- **ntfy** (the ntfy app, no Home Screen app needed): it uses the `ntfy.json` of *App alerts* above. To keep reminders apart from app problems, give them their own topic, subscribe to it in the ntfy app, and add it to the file:

  ```sh
  sudo -u '#1000' sh -c 'umask 077 && cat > /DATA/AppData/notesapp/data/secrets/ntfy.json' <<'EOF'
  { "server": "https://ntfy.sh", "topic": "notes-<hex>", "reminders": { "topic": "notes-remind-<hex>" } }
  EOF
  ```

  Then switch on **Send through ntfy**. **Title only** (on by default) sends just the task's title: with ntfy.sh that title still leaves your tailnet.
- **In the app:** **Show in open tabs** shows reminders in any open NotesApp tab (and as a browser notification after **Allow**).

Reminders use the time zone your devices report; **Settings › Reminders › Status** shows it, and the next reminders.

### GitHub mirror

Pushes the vault's git history to a **private** GitHub repository about 10 minutes after you stop editing (DEPLOY.md *Mirror to GitHub*; your notes then also live on GitHub). Create the empty private repository and the fine-grained token exactly as in DEPLOY.md steps 1 and 2, then:

```sh
sudo -u '#1000' sh -c 'umask 077 && cat > /DATA/AppData/notesapp/data/secrets/mirror-token'
# paste the token (github_pat_...), press Enter, then Ctrl-D
```

Then set `NOTES_MIRROR_URL` to `https://github.com/<you>/<repo>.git` in the app's settings (above) and save. Use the HTTPS URL: an SSH URL (`git@github.com:…`) or one with the token in it is refused, and the status bar and status page say *Mirror is off: …*. Run **Push history to the mirror now** from the command palette and check **Settings › About › Mirror**. To rotate the token, replace the file's content: it is read before every push. To turn the mirror off, empty `NOTES_MIRROR_URL`.

### Ask your vault (Claude)

Questions about your notes with answers that cite them, summaries of a note, a folder, a selection or this week's daily notes, and suggested links, tags and tasks, written by Claude (DEPLOY.md *Ask your vault* has the details). By default it runs **Claude Code with your Claude subscription** (Pro or Max): the image contains the Claude Code CLI, and the server runs it for each question with every tool switched off, so Claude sees only the notes NotesApp hands it. **When you use it, your question and the text of the notes it needs are sent to Anthropic**; notes in excluded folders (`Private` by default) never are. Usage counts against your plan's usage limits like your own Claude use, and is for your personal use under your plan's terms. It stays off until you add a token **and** switch it on in Settings.

1. **A token.** On any computer where Claude Code is logged in to your Claude account (`claude` once, then `/login`), run `claude setup-token`. It prints a long-lived token (`sk-ant-oat01-…`) for your subscription.
2. **Save it on the server:**
   ```sh
   sudo -u '#1000' sh -c 'umask 077 && cat > /DATA/AppData/notesapp/data/secrets/claude-token'
   # paste the token, press Enter, then Ctrl-D
   ```
   No restart and no compose change: the app reads `/data/secrets/claude-token` and notices a new token by itself.
3. **Switch it on.** **Settings › Ask and summaries**: turn on **Use Claude**, keep **Provider** on *Claude Code*, check **Never send** and the model; the status there says *Ready* and *Token found in claude-token*. Ask in the **Ask** panel (the sparkles tab of the right sidebar) or, on the iPhone, **Ask your vault** in the drawer.

The **monthly budget** ($5 by default) caps the API value of your usage that Claude Code reports, as a guard against using up your plan; nothing is charged per question. To rotate the token, run `claude setup-token` again and replace the file's content; to stop, switch **Use Claude** off and delete the file.

**Keep the GHCR package private** (section 1, step 3) once the image contains Claude Code: Claude Code is Anthropic's proprietary software, and a public image would hand it out to anyone. If your package is public, either make it private, or build the image with `--build-arg CLAUDE_CODE_VERSION=none` (DEPLOY.md *Ask your vault* explains mounting the CLI instead).

With an Anthropic API key instead (billed per token): put the key in `/DATA/AppData/notesapp/data/secrets/anthropic-key` the same way and choose **Provider: Anthropic API**.

### Large files

Files over 25 MB stay in the vault and in backups but out of git history (DEPLOY.md *Large files*). To change that, set `NOTES_GIT_LARGE_FILE_THRESHOLD` in the app's settings (for example `50MB`; `0` versions every file). It must be `0` or at least `5MB`, otherwise the app refuses to start and its log says why.

### Voice note transcription

Voice notes record without any setup (**Record voice note** in the command palette, or the microphone on the iPhone's editing toolbar); the audio is saved as an attachment and embedded in the note. To also get the **text** under each recording, install a local speech-to-text service as a second CasaOS app, [`deploy/casaos-whisper-compose.yml`](../deploy/casaos-whisper-compose.yml) (DEPLOY.md *Voice notes* has the background). It adds one container:

| Container | Job |
|---|---|
| `notesapp-whisper` | [whisper-asr-webservice](https://github.com/ahmetoner/whisper-asr-webservice) with faster-whisper on the CPU. Like NotesApp it shares the host's network and listens on the host's loopback only (`127.0.0.1:18097`), so only NotesApp and the host reach it, and it keeps no audio |

1. Optionally change `ASR_MODEL` in the file: `base` for a slow or arm64 CPU, `small` (the default), `medium` for better text with a strong CPU and about 2 GB of RAM.
2. CasaOS → **App Store → Custom Install → Import**, paste, **Submit**, **Install**. The image is large (about 2.7 GB); on its first start it downloads the model into `/DATA/AppData/notesapp/whisper` (about 0.5 GB for `small`). Its log (CasaOS → NotesApp Whisper → **Logs**) shows when it is ready.
3. In NotesApp's settings (the `notes` container, as above), set `NOTES_TRANSCRIPTION_URL` to `http://127.0.0.1:18097` and save. Optionally add `NOTES_TRANSCRIPTION_LANGUAGE` (for example `en`; empty detects the language of each recording).
4. In the app, **Settings › This device** now says *New recordings are transcribed by whisper-asr at http://127.0.0.1:18097*. Record a few words to try it.

To turn it off, empty `NOTES_TRANSCRIPTION_URL`, then uninstall the NotesApp Whisper app if you like. NotesApp runs the same with or without it. Other engines (whisper.cpp's server, speaches, an API) are in DEPLOY.md *Voice notes*; an API key goes in `/DATA/AppData/notesapp/data/secrets/transcription-key`, never in an environment variable.

### Public publishing

**Off as installed; nothing is public.** Publishing shares chosen notes as read-only web pages with people outside your tailnet through Tailscale Funnel, without exposing the app: a separate server in the container (on a port of its own, never the app's) serves only the snapshots of notes you published, and the app itself refuses anything that came through Funnel. DEPLOY.md *Public publishing* has the background (what a page contains, how to check it from outside).

The publish server listens on `127.0.0.1` (here the host's loopback, like the app) unless `NOTES_PUBLISH_ADDRESS` says otherwise, so with this layout it takes these changes; none of them alone exposes anything to the internet:

1. **Tailscale admin console → Access controls**: allow Funnel for the host, e.g. `"nodeAttrs": [ { "target": ["autogroup:member"], "attr": ["funnel"] } ]` (or a narrower target that includes the host).
2. CasaOS → NotesApp → **Settings**, the `notes` container:
   - set `NOTES_PUBLISH_ENABLED` to `true`, `NOTES_PUBLISH_PORT` to `18096` (the publish server's port on the host's loopback; its default, 8081, is often taken on a host), and `NOTES_PUBLISH_BASE_URL` to `https://homeserver.<tailnet>.ts.net:10000` (only used for the links the app copies). Leave `NOTES_PUBLISH_ADDRESS` unset: `127.0.0.1` keeps the publish server off the LAN too;
   - **Save**. The log then says *Publish server listening on 127.0.0.1:18096*.
3. Over SSH, put the publish server alone on the internet. Funnel offers the ports 443, 8443 and 10000; 443 and 8443 are taken here, so:
   ```sh
   sudo tailscale funnel --bg --https=10000 http://127.0.0.1:18096
   tailscale funnel status       # :10000 (Funnel on) → 18096; :8443 (tailnet only) → 18095
   ```
   Never point Funnel at 18095: the app would refuse those requests anyway, but nothing of it belongs on the internet.

Publish a note with the globe in its header, **Publish to the web** in the ⋯ menu, or the command palette; **Settings › Publishing** lists published notes with Republish and Unpublish. Snapshots are stored in `/DATA/AppData/notesapp/data/publish`, outside the vault.

To turn it off: `sudo tailscale funnel --https=10000 off` (the internet loses access at once), then set `NOTES_PUBLISH_ENABLED` to `false`. Unpublish notes in Settings › Publishing to delete their snapshots.

### Multiple vaults

Settings › Vaults › **New vault** creates a separate vault (for example `work`), with its own notes, search, history, trash, settings, bookmarks, tasks and reminders, at `https://homeserver.<tailnet>.ts.net:8443/v/work/` (the same `tailscale serve` covers it; nothing changes in CasaOS). Its folder is `/DATA/AppData/notesapp/data/vaults/work`, created by the app as uid 1000; a folder you make yourself must be owned by uid 1000 too (`sudo install -d -o 1000 -g 1000 /DATA/AppData/notesapp/data/vaults/work`, then restart the app). A vault switcher appears at the top of the sidebar (the drawer on the iPhone) once there are two vaults. Your existing vault, its address and the home-screen app do not change. Publishing, the GitHub mirror, the share sheet and the web clipper stay with the existing vault. To rename or delete a vault: stop the app in CasaOS, rename or remove its folder with the **Files** app, start the app. To stop the app from creating vaults, add `NOTES_VAULTS_ALLOW_CREATE` = `false` to the `notes` container's environment. DEPLOY.md *Multiple vaults* has the details.

### Sharing with family

Share **one note or one folder** with someone else, to view or to edit, without the rest of your vault (a shopping list with your partner, recipes with your parents). There are no accounts: NotesApp knows people by their Tailscale login, and a family member sees only what you shared with that login. DESIGN.md §5.40 has the design.

1. **Check that you are the owner.** `NOTES_IDENTITY_ALLOWED_LOGINS`, set when you installed (section 2), names the owners: your own Tailscale login (the email the admin console shows for you; comma-separate several people who should have *everything*). An install from an older compose file may have it unset: then set it in CasaOS → NotesApp → **Settings**, the `notes` container, and **Save**. Without it, everyone who can reach NotesApp already has the whole vault, so sharing stays off and **Settings › Sharing** says why. Never put family on this list: everyone on it has everything.
2. **Give them a way in.** Their phone or computer needs Tailscale, signed in to some account. Either:
   - **Share this machine** (recommended): admin console → **Machines** → the host → **⋯** → **Share…**, and send the invite to their email (or copy an invite link). They install Tailscale, sign in with their own account (Google, Apple, Microsoft, GitHub or email), and accept. They see only this machine, nothing else of your tailnet; their login is the account they accepted with. Sharing is on every Tailscale plan; your own tailnet does not grow.
   - **Invite them to your tailnet** (admin console → **Users** → **Invite users**): they then join as members, which counts toward your plan's users and, under the default *allow everything* policy, lets them reach **every** device of your tailnet. Only do this together with step 3.
3. **Let them reach NotesApp and nothing else.** Tailscale's default policy allows every connection, and `"src": ["*"]` includes the people you share a machine with: they could open every port of the host (the CasaOS dashboard, your other apps). In the admin console → **Access controls**, replace the allow-all rule (`{"src": ["*"], "dst": ["*"], "ip": ["*"]}` in `grants`, or `{"action": "accept", "src": ["*"], "dst": ["*:*"]}` in older `acls`) with:
   ```json
   "hosts": { "homeserver": "100.x.y.z" },   // the host's Tailscale IPv4 (tailscale ip -4)
   "grants": [
     // You: everything, as before (list each login of yours).
     { "src": ["you@example.com"], "dst": ["*"], "ip": ["*"] },
     // Everyone else: NotesApp's HTTPS port on the host, nothing more.
     { "src": ["autogroup:shared", "autogroup:member"], "dst": ["homeserver"], "ip": ["tcp:8443"] },
   ],
   ```
   (`autogroup:shared` is everyone you share a machine with; `autogroup:member` matters only if you invite members, and they keep reaching their own devices only if you add `{ "src": ["autogroup:member"], "dst": ["autogroup:self"], "ip": ["*"] }`.) The **Preview rules** tab shows what each person can reach. Your own access does not change.
4. **Share.** In NotesApp: a note's **⋯** menu → **Share with family…**, a folder's (or note's) menu in the file list → **Share…**, or the command palette. Choose **Can view** or **Can edit**, type their Tailscale login (they can read it off the page in step 5 if you are not sure), optionally **Also make a link** and an end date, then **Share**, and send them the address the dialog shows. A link works for anyone who can reach NotesApp, so treat it like a key: it is shown once (the server keeps only a fingerprint of it), and **New link** or **Remove link** replaces or ends it.
5. **What they see.** The address opens the note (or the folder's notes) in their browser: editable for *Can edit*, with your autosave, conflict handling and live updates, and your note's history records them as its author; read-only for *Can view*. `https://homeserver.<tailnet>.ts.net:8443` itself shows them everything shared with them and the login they are signed in with. On an iPhone, **Share → Add to Home Screen** keeps it one tap away. They never see your other notes, search, settings, history or anything else.

**Settings › Sharing** lists every share with its people, link, end date and state; **Stop sharing** ends it at once, open pages included. To cut someone off from the host entirely, remove the machine share (or the user) in the admin console. Guessing addresses is rate-limited: a login refused 20 times in 15 minutes is locked out for a while, and with *App alerts* set up you get a notification (`SHARE_RATE_LIMITED`).

### Nightly backups

A second CasaOS app, [`deploy/casaos-backup-compose.yml`](../deploy/casaos-backup-compose.yml), takes encrypted [restic](https://restic.net) snapshots of the vault, its history (and, with the advanced layout, the Tailscale identity) every night, to a second disk and optionally to Backblaze B2 or Amazon S3 (DEPLOY.md *Backups* explains the design: NotesApp is stopped for the seconds the local snapshot takes). It adds two containers:

| Container | Job |
|---|---|
| `notesapp-backup` | The restic sidecar. Mounts the data read-only; every backup step runs in it |
| `notesapp-backup-scheduler` | Starts each night's run at `NOTES_BACKUP_TIME` (04:00). Holds the Docker socket, like Watchtower, to stop and start `notesapp` |

It refuses to install until steps 1 and 2 are done, and NotesApp itself runs the same with or without it.

**1. A second disk.** Add it in CasaOS's storage settings, or mount it yourself (DEPLOY.md *Set up the nightly backups*, step 1). Note where it is mounted, then create the repository directory on it. It must be a different filesystem from `/DATA`, or the backup refuses to run:

```sh
df -h /DATA /media/<disk>                         # two different devices
sudo install -d -m 700 /media/<disk>/notes-restic
```

**2. Scripts and secrets** in `/DATA/AppData/notesapp/backup/`. Copy the three scripts from `deploy/backup/` in your checkout of this repository, for example with `scp deploy/backup/*.sh <you>@<server>:/tmp/` from your PC:

```sh
sudo install -d /DATA/AppData/notesapp/backup/scripts
sudo cp /tmp/nightly.sh /tmp/restic-job.sh /tmp/scheduler.sh /DATA/AppData/notesapp/backup/scripts/
sudo install -d -m 700 /DATA/AppData/notesapp/backup/secrets
sudo sh -c 'umask 077 && head -c 33 /dev/urandom | base64 > /DATA/AppData/notesapp/backup/secrets/restic-password'
sudo install -m 600 /dev/null /DATA/AppData/notesapp/backup/secrets/backup-offsite-credentials
sudo nano /DATA/AppData/notesapp/backup/secrets/backup-offsite-credentials   # S3 keys; leave empty without off-site
sudo cat /DATA/AppData/notesapp/backup/secrets/restic-password              # into your password manager, now
```

The credentials file has the AWS format shown in DEPLOY.md step 3, for B2 too. **Keep the password in your password manager**: the snapshots are encrypted with it, and without it nothing can be restored. When an update changes `deploy/backup/`, copy the scripts again and restart the NotesApp Backup app.

**3. Install.** In `casaos-backup-compose.yml`, replace `/media/CHANGE-ME/notes-restic` with the directory from step 1, and set as needed: `TZ` (the same as NotesApp's), `NOTES_BACKUP_OFFSITE_REPO` (B2: `s3:https://s3.us-west-004.backblazeb2.com/<bucket>/notes`; S3: `s3:https://s3.<region>.amazonaws.com/<bucket>/notes`; empty = the second disk only), `NOTES_BACKUP_NTFY_URL` (`https://ntfy.sh/notes-<hex>`, for failures and a weekly OK on Sundays) and `NOTES_BACKUP_HEARTBEAT_URL` (optional, a healthchecks.io ping URL). Then CasaOS → **App Store → Custom Install → Import**, paste, **Submit**, **Install**.

**4. Create the repositories and run the first backup by hand.** NotesApp is down while the first run reads every file:

```sh
docker exec notesapp-backup sh /backup/restic-job.sh init
docker logs notesapp-backup-scheduler                         # "next backup run: ... 04:00 ..."
docker exec notesapp-backup-scheduler sh /backup/nightly.sh   # ends with "backup run finished"
docker exec notesapp-backup sh /backup/restic-job.sh snapshots
```

The status page's *Backups* card now shows the run, and lists a failed run, or none for 36 hours, among its problems. A failure alert names the failed steps; restic's own messages are on the status page and in `docker logs notesapp-backup-scheduler`. Everything else in DEPLOY.md *Backups* applies with `docker exec notesapp-backup …` and `docker exec notesapp-backup-scheduler …` in place of `docker compose exec backup …` and `docker compose exec backup-scheduler …`. To pause the backups, stop the NotesApp Backup app in CasaOS.

**Restore** (the whole vault; the current one is moved aside, never deleted). restic restores into an empty directory, here in the backup app's cache folder:

```sh
docker exec notesapp-backup sh /backup/restic-job.sh snapshots              # pick one, or take the latest
docker exec notesapp-backup mkdir /cache/restore
docker exec notesapp-backup sh /backup/restic-job.sh restore local notes-data /cache/restore
sudo ls -la /DATA/AppData/notesapp/backup/cache/restore/vault             # look before you swap
docker stop notesapp-backup-scheduler notesapp
sudo mv /DATA/AppData/notesapp/data/vault /DATA/AppData/notesapp/data/vault.before-restore
sudo mv /DATA/AppData/notesapp/backup/cache/restore/vault /DATA/AppData/notesapp/data/vault
sudo chown -R 1000:1000 /DATA/AppData/notesapp/data/vault
docker start notesapp notesapp-backup-scheduler
```

Use `offsite` instead of `local` when the second disk is gone. Check the result as in DEPLOY.md *Check a restored vault*, then delete `vault.before-restore` and `/DATA/AppData/notesapp/backup/cache/restore`. Do a restore drill once after the setup.

## If something is wrong

| Symptom | Check |
|---|---|
| `notesapp` keeps restarting | CasaOS → app → **Logs**. `NOTES_ALLOWED_HOSTS ... must list`: the variable is empty. `No kernel-mode Tailscale interface`: `NOTES_SECURITY_REQUIRE_TAILSCALE_INTERFACE` must be `"false"` in this layout. *Access denied* or *not writable* on `/data`: the data folder isn't owned by uid 1000 (section 1, step 2). |
| Image pull fails with `denied` / `unauthorized` | The package is private and the server isn't logged in to GHCR (section 1, step 3). |
| `403` in the browser | Your Tailscale login doesn't match `NOTES_IDENTITY_ALLOWED_LOGINS` (still `you@example.com`, or another spelling of your login: use the email the admin console shows), or you're on a tagged device. (A login outside the list sees only what is shared with it: the server's address sends it to its list of shares.) |
| A family member sees *This share is not available* | The share was stopped or ended, its link was replaced, or it names another login: they open `https://homeserver.<tailnet>.ts.net:8443` to see the login they are signed in with, and you check it in Settings › Sharing. |
| Settings › Sharing says sharing is off | `NOTES_IDENTITY_ALLOWED_LOGINS` is empty (*Sharing with family*, step 1). |
| A family member gets no answer at all from the address | Tailscale isn't connected on their device, the machine share wasn't accepted, or your access controls don't give them `tcp:8443` on the host (*Sharing with family*, steps 2 and 3). |
| `421` in the browser | The host name you opened doesn't match `NOTES_ALLOWED_HOSTS` (a placeholder left in, or a typo in the tailnet name). Use the `https://…ts.net:8443` address: `http://<server-ip>:18095` is not reachable from other machines at all. |
| `403` from `http://127.0.0.1:18095` but the HTTPS address works | Expected: only `tailscale serve` adds the identity headers. |
| `https://…:8443` does not load | `tailscale serve status` must show `:8443` → `http://127.0.0.1:18095` (section 2, step 3); `curl -sI http://127.0.0.1:18095` on the host must answer. If it does not, the `notes` container must have `network_mode: host`, `SERVER_ADDRESS: 127.0.0.1` and `SERVER_PORT: "18095"`, and nothing else on the host may use port 18095. |
| `notes` never appears in Tailscale (advanced layout) | The auth key was wrong, already used, or `tag:notes` has no tag owner. Generate a new key and **Rebuild** the app. |
| Certificate warning | HTTPS Certificates aren't enabled in the tailnet's DNS settings. |
| `502 Bad Gateway` | The app is (re)starting, e.g. after a Watchtower update; it is back within a minute. Otherwise check the app's log. |
| `notesapp` keeps restarting, log says `notes.git.large-file-threshold (…) is below the largest text size limit` | Set `NOTES_GIT_LARGE_FILE_THRESHOLD` to `0` or at least `5MB` (*Large files*). |
| *Mirror is off: …* in the status bar | `NOTES_MIRROR_URL` is not a plain `https://github.com/<you>/<repo>.git` URL (*GitHub mirror*). Other mirror messages: DEPLOY.md Part 3. |
| The *Ask* panel says *no Claude Code token* or *not readable* | `/DATA/AppData/notesapp/data/secrets/claude-token` is missing, empty or not owned by uid 1000 (*Ask your vault*). *Claude Code refused the token*: run `claude setup-token` again and replace the file. *usage limit is reached*: your plan's limit; wait for it to reset. Other messages: DEPLOY.md *"Ask your vault says it is unavailable"*. |
| NotesApp Backup does not install: `bind source path does not exist` | The repository directory (step 1), `backup/scripts` or `backup/secrets` (step 2) is missing, or the second disk is not mounted. |
| *NotesApp backup failed* | The status page's *Backups* card has restic's message; DEPLOY.md *"NotesApp backup failed"* explains each one. `not initialized`: run `init` (step 4). |
| *NotesApp is down after the backup* | Restart NotesApp in CasaOS (or `docker start notesapp`), then read its log. |
| Status page: "No backup has reported here yet" | NotesApp Backup is not installed, or has not run yet (step 4). |
| *Transcribing … failed: cannot connect to http://127.0.0.1:18097* | The NotesApp Whisper app is stopped or still downloading its model (its **Logs**). Its compose must have `network_mode: host` and the `command` that sets `--host 127.0.0.1 --port 18097`. |
| *Transcription is off* | `NOTES_TRANSCRIPTION_URL` is empty in NotesApp's settings (*Voice note transcription*, step 3). |
| *Microphone access was refused* | Safari's **aA** menu › Website Settings › Microphone › Allow (iPhone), or the site settings in the browser. |

## Advanced: own Tailscale container

[`deploy/casaos-compose-sidecar.yml`](../deploy/casaos-compose-sidecar.yml) is the earlier layout: a `notesapp-tailscale` container joins the tailnet as its own machine `notes` (with an auth key and `tag:notes`) and serves `https://notes.<tailnet>.ts.net`, and the app has no published port at all, so nothing on the LAN can reach it. It is for a host without Tailscale, or for a separate machine name in the tailnet.

**CasaOS does not install it as it was designed.** The design shared the Tailscale container's network namespace (`network_mode: service:tailscale`), and CasaOS sets a hostname on every container it creates, which Docker refuses for a container that shares another's network (*conflicting options: hostname and the network mode*). The file therefore puts both containers on a private network, `notes-internal`, where `tailscale serve` reaches the app as `notesapp:8080` (and the publish server as `notesapp:8081`, with `NOTES_PUBLISH_ADDRESS: 0.0.0.0`); the app's own Tailscale interface check and netns watchdog are off. With plain Docker Compose (DEPLOY.md) the shared-namespace layout works unchanged.

To use it:

1. Tailscale admin console: MagicDNS and HTTPS Certificates on; a tag owner `"tagOwners": { "tag:notes": ["autogroup:admin"] }`; **Settings → Keys → Generate auth key** with Reusable off, Ephemeral off, Pre-approved on, Tags `tag:notes`. Tagged machines don't expire, so the key is used once; blank `TS_AUTHKEY` after the first start.
2. In the file, replace `tskey-auth-CHANGE-ME`, `notes.CHANGE-ME.ts.net` (every place, including both `serve.json` branches) and `NOTES_IDENTITY_ALLOWED_LOGINS`. The `tailscale` container makes the data folder writable by uid 1000 itself.
3. Install it as in section 2, then open `https://notes.<tailnet>.ts.net`. `/DATA/AppData/notesapp/tailscale/` holds the node identity and certificates; never delete it (the nightly backups include it).

Publishing with this layout: set `NOTES_PUBLISH_FUNNEL` to `true` on the `tailscale` container (its next start writes a `serve.json` with `:8443` → `notesapp:8081` and Funnel for that port alone), `NOTES_PUBLISH_ENABLED` to `true` and `NOTES_PUBLISH_BASE_URL` to `https://notes.<tailnet>.ts.net:8443` on `notes`, and allow Funnel for `tag:notes` in the access controls (`"nodeAttrs": [ { "target": ["tag:notes"], "attr": ["funnel"] } ]`).

The NotesApp Whisper app listens on the host's loopback, which the app cannot reach in this layout (it is not on the host's network). Put it on the app's network instead: in its compose, replace `network_mode: host` and `command:` with `networks: [notesapp]` and add

```yaml
networks:
  notesapp:
    external: true
    name: notesapp_notes-internal               # created by this layout (name: notesapp)
```

then set `NOTES_TRANSCRIPTION_URL` to `http://notesapp-whisper:9000` (the image's own port on that network).
