# NS3H — Design Specification

**Version:** 1.0
**Purpose:** Implementation brief for Claude Code.

---

## 1. What NS3H is

A cross-platform terminal client for network engineers. It connects to anything — modern Linux hosts, 20-year-old Cisco switches, serial consoles, telnet-only gear — without the user ever configuring a cipher. Every session is logged to disk automatically.

**Design principle:** the app is self-contained and opinionated. It offers every SSH algorithm it has, always, in a fixed preference order. There are no cipher settings in the UI. There is nothing for the user to get wrong.

**Non-goals for v1:** jump hosts / bastions, cloud sync, team sharing, scripting/automation, log full-text search, SSH agent forwarding, port forwarding.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | Electron (latest stable) | Chosen for `ssh2`'s legacy algorithm coverage |
| Build | electron-vite | Fast HMR, sane main/preload/renderer split |
| UI | React 18 + TypeScript | |
| Styling | CSS Modules + CSS custom properties | No Tailwind; theme tokens must be swappable later |
| Terminal | xterm.js + `@xterm/addon-fit` + `@xterm/addon-webgl` + `@xterm/addon-search` | WebGL renderer is required — large output dumps chug without it |
| SSH/SFTP | `ssh2` | |
| Serial | `serialport` | Native module — needs `electron-rebuild` |
| Telnet | Node `net` socket + custom IAC handling | No adequate library; write it |
| Secrets | `safeStorage` (Electron built-in) | Keychain / DPAPI / libsecret |
| Layout | `dockview` or `rc-dock` | For tabs + drag-to-split |
| State | Zustand | |

### Process model

All Node-side work (`ssh2`, `serialport`, `net`, `fs`) lives in the **main process**. The renderer is sandboxed with `contextIsolation: true` and `nodeIntegration: false`, talking to main over a typed IPC bridge in the preload script.

Session data streams main → renderer over IPC channels keyed by session ID. The renderer writes bytes into xterm.js; keystrokes go renderer → main.

**Logging happens in main, on the raw stream, not in the renderer.** This means a session keeps logging even if its tab is backgrounded or the terminal is destroyed.

---

## 3. Connection core

### 3.1 SSH algorithm policy

Hard-coded in `src/main/ssh/algorithms.ts`. Not user-editable. Not exposed in settings.

```ts
export const FULL_ALGORITHMS = {
  kex: [
    'curve25519-sha256',
    'curve25519-sha256@libssh.org',
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group16-sha512',
    'diffie-hellman-group18-sha512',
    'diffie-hellman-group14-sha256',
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group-exchange-sha1',
    'diffie-hellman-group1-sha1',
  ],
  serverHostKey: [
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'rsa-sha2-512',
    'rsa-sha2-256',
    'ssh-rsa',
    'ssh-dss',
  ],
  cipher: [
    'chacha20-poly1305@openssh.com',
    'aes128-gcm@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-ctr',
    'aes192-ctr',
    'aes256-ctr',
    'aes256-cbc',
    'aes192-cbc',
    'aes128-cbc',
    '3des-cbc',
    'blowfish-cbc',
    'cast128-cbc',
    'arcfour256',
    'arcfour128',
    'arcfour',
  ],
  hmac: [
    'hmac-sha2-256-etm@openssh.com',
    'hmac-sha2-512-etm@openssh.com',
    'hmac-sha1-etm@openssh.com',
    'hmac-sha2-256',
    'hmac-sha2-512',
    'hmac-sha1',
    'hmac-md5',
    'hmac-sha1-96',
    'hmac-md5-96',
  ],
};

// Trimmed proposal for devices that reject an oversized KEXINIT.
export const LEGACY_ALGORITHMS = {
  kex: [
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group-exchange-sha1',
    'diffie-hellman-group1-sha1',
  ],
  serverHostKey: ['ssh-rsa', 'ssh-dss'],
  cipher: ['aes128-cbc', 'aes256-cbc', '3des-cbc'],
  hmac: ['hmac-sha1', 'hmac-md5'],
};
```

Order matters: modern algorithms are offered first, so a modern server negotiates modern crypto. The legacy entries only get selected when they're all the device has.

### 3.2 Connection retry ladder

Some old IOS builds fail on a large KEXINIT packet, so offering everything can itself cause the failure. Attempt in order, stopping at the first success:

1. `FULL_ALGORITHMS`
2. `LEGACY_ALGORITHMS`

If both fail, surface the raw negotiation error to the user — including what the server offered — not a generic "connection failed."

Write the negotiated algorithm set into the session log header (§5.2) so failures are diagnosable after the fact.

### 3.3 Authentication

Support, in this order, per host config:

- `publickey` (with optional passphrase prompt)
- `password`
- `keyboard-interactive` — **required**; many network devices and TACACS+ deployments use this rather than `password`

If a stored credential fails, prompt inline in the terminal pane rather than failing the session outright.

### 3.4 Host keys

Stored in `known-hosts.json` (§4.4), not OpenSSH format.

- **Unknown key** → modal showing hostname, key type, and SHA256 fingerprint. Accept stores it; reject aborts.
- **Changed key** → modal showing old and new fingerprints side by side, with clear wording that this is expected after an RMA or OS upgrade but is also what a MITM looks like. Accepting overwrites the stored key.

No "disable verification" global toggle.

### 3.5 Telnet

Raw `net.Socket` plus IAC option negotiation. Minimum viable set:

- `IAC DO/WILL` handling for `ECHO` (1), `SUPPRESS-GO-AHEAD` (3), `TERMINAL-TYPE` (24), `NAWS` (31)
- Respond to `TERMINAL-TYPE` subnegotiation with `xterm-256color`
- Send `NAWS` on connect and on every terminal resize
- Refuse (`WONT`/`DONT`) anything else

Escape `0xFF` bytes in outbound data as `IAC IAC`.

### 3.6 Serial

Per-host settings, all editable, with these defaults:

| Field | Default | Options |
|---|---|---|
| Port | *(required, no default)* | Dropdown from `SerialPort.list()`, plus free-text entry |
| Baud | 9600 | 2400, 4800, 9600, 19200, 38400, 57600, 115200 |
| Data bits | 8 | 7, 8 |
| Parity | none | none, even, odd |
| Stop bits | 1 | 1, 2 |
| Flow control | none | none, RTS/CTS, XON/XOFF |

The port dropdown must refresh on open — USB adapters get plugged in mid-session. Show the manufacturer string alongside the path (e.g. `/dev/ttyUSB0 — FTDI FT232R`) since users won't recognise bare paths.

**Send Break** button in the session toolbar (`port.set({ brk: true })`, hold 250 ms, release). Needed for Cisco password recovery.

Error handling: on a permissions error opening a Linux port, the message must name the fix — add the user to the `dialout` group — rather than showing `EACCES`.

### 3.7 Keepalive

SSH: `keepaliveInterval: 30000`, `keepaliveCountMax: 3`. Telnet: TCP keepalive on. Serial: n/a.

---

## 4. Data model

All config lives in one directory. Location by platform:

- Linux: `~/.config/ns3h/`
- macOS: `~/Library/Application Support/ns3h/`
- Windows: `%APPDATA%\ns3h\`

Files are plain JSON, hand-editable, safe to put in git (no secrets).

### 4.1 `hosts.json`

```json
{
  "version": 1,
  "folders": [
    { "id": "fld_a1b2", "name": "Datacenter", "parentId": null }
  ],
  "hosts": [
    {
      "id": "hst_c3d4",
      "name": "core-sw-01",
      "protocol": "ssh",
      "folderId": "fld_a1b2",
      "address": "10.1.1.5",
      "port": 22,
      "credentialId": "crd_e5f6",
      "inlineCredential": null,
      "logging": true,
      "serial": null,
      "createdAt": "2026-08-14T10:00:00Z"
    },
    {
      "id": "hst_g7h8",
      "name": "console-rtr-03",
      "protocol": "serial",
      "folderId": null,
      "address": null,
      "port": null,
      "credentialId": null,
      "inlineCredential": null,
      "logging": true,
      "serial": {
        "path": "/dev/ttyUSB0",
        "baudRate": 9600,
        "dataBits": 8,
        "parity": "none",
        "stopBits": 1,
        "flowControl": "none"
      }
    }
  ]
}
```

- `protocol`: `"ssh" | "telnet" | "serial"`
- `credentialId` and `inlineCredential` are mutually exclusive. Inline credentials still store their secret in the keychain (keyed by host ID) — never in this file.
- `logging` defaults to `true` on the Add Host form.

### 4.2 `credentials.json`

```json
{
  "version": 1,
  "credentials": [
    {
      "id": "crd_e5f6",
      "name": "Network admin",
      "type": "password",
      "username": "admin",
      "keyPath": null,
      "hasPassphrase": false
    },
    {
      "id": "crd_i9j0",
      "name": "Linux key",
      "type": "key",
      "username": "will",
      "keyPath": "/home/will/.ssh/id_ed25519",
      "hasPassphrase": true
    }
  ]
}
```

Secrets — passwords and key passphrases — go to `safeStorage`, written to `secrets.enc` keyed by credential ID. Private keys themselves stay on disk at `keyPath`; NS3H never copies key material.

### 4.3 `settings.json`

```json
{
  "version": 1,
  "logDirectory": "/home/will/ns3h-logs",
  "theme": "dark-red",
  "fontFamily": "JetBrains Mono",
  "fontSize": 13,
  "scrollback": 10000,
  "sidebarWidth": 20
}
```

`logDirectory` is unset on first run. Prompt for it on first launch and block session logging until set (with a clear banner, not a silent failure).

### 4.4 `known-hosts.json`

```json
{
  "version": 1,
  "entries": [
    {
      "address": "10.1.1.5",
      "port": 22,
      "keyType": "ssh-rsa",
      "fingerprint": "SHA256:abc123...",
      "acceptedAt": "2026-08-14T10:00:00Z"
    }
  ]
}
```

Keyed on `address:port`, not friendly name, so a renamed host keeps its trust.

---

## 5. Logging

### 5.1 Paths

```
<logDirectory>/
  core-sw-01/
    2026-08-14_101500.log
    2026-08-14_143022.log
    .meta.json
  _quick/
    10.1.1.99/
      2026-08-14_150200.log
```

- Saved hosts log under their **friendly name**, sanitised: strip `/ \ : * ? " < > |`, collapse whitespace to `_`, trim to 120 chars. On collision, append the short host ID.
- Quick connections log under `_quick/<address>/`.
- `.meta.json` in each folder records the host ID and any rename history, so old logs stay attributable after a rename. Renaming a host does **not** move existing logs.

### 5.2 File format

Plain text, `.log`, UTF-8. Header block, then session output:

```
=== NS3H session ===
Host:       core-sw-01 (10.1.1.5:22)
Protocol:   ssh
User:       admin
Started:    2026-08-14 10:15:00 -0400
KEX:        diffie-hellman-group14-sha1
Cipher:     aes128-cbc
MAC:        hmac-sha1
Host key:   ssh-rsa SHA256:abc123...
====================

<session output>

=== Session ended 2026-08-14 10:47:12 -0400 (duration 32m12s) ===
```

For telnet and serial, omit the crypto lines and record the relevant parameters instead (baud/parity/etc. for serial).

### 5.3 What gets written

The captured stream is what the user saw, cleaned for readability:

1. Strip CSI, OSC, and other ANSI escape sequences.
2. Resolve in-line overwrites: honour backspace (`0x08`) and bare carriage return by rewriting the current line buffer rather than emitting raw control bytes. This is what makes a `--More--` paged `show run` come out readable instead of as a mess of backspaces.
3. Normalise line endings to `\n`.
4. Append.

Commands the user types appear in the log because the device echoes them back — no separate keystroke capture is needed, and passwords stay absent because echo is suppressed at password prompts.

Write with a buffered append stream, flushed at least every 2 seconds, and flushed on session close and on app quit.

### 5.4 Warning

Session logs will contain `show run` output — password hashes, SNMP community strings, pre-shared keys. Surface this once, in Settings next to the log directory picker, in plain language. Do not repeat it per session.

---

## 6. UI

### 6.1 Design tokens

```css
:root {
  /* Surfaces — near-black, layered */
  --bg-base:      #0A0A0B;
  --bg-panel:     #131315;
  --bg-elevated:  #1B1B1F;
  --bg-hover:     #232328;

  /* Lines */
  --border:       #2A2A30;
  --border-focus: #3A3A42;

  /* Text */
  --text-primary:   #F5F5F7;
  --text-secondary: #9A9AA2;
  --text-tertiary:  #6A6A72;

  /* Accent — red */
  --accent:        #E5484D;
  --accent-hover:  #F2555A;
  --accent-muted:  rgba(229, 72, 77, 0.14);

  /* Status */
  --status-ok:    #3DD68C;
  --status-warn:  #F5A623;
  --status-error: #E5484D;

  --radius-sm: 5px;
  --radius-md: 8px;
  --radius-lg: 11px;
}
```

**Typography.** UI: system stack — `-apple-system, "Inter", "Segoe UI Variable", system-ui, sans-serif`. Terminal and log viewer: `"JetBrains Mono", "SF Mono", "Cascadia Mono", monospace`, 13px default.

**macOS-style chrome.** `titleBarStyle: 'hiddenInset'` on macOS with content inset for the traffic lights. On Windows and Linux, a custom frameless title bar with matching height and right-aligned controls, so the app reads the same everywhere. Sidebar uses a translucent/vibrancy effect on macOS where available, solid `--bg-panel` elsewhere.

### 6.2 Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ● ● ●                    NS3H                          [⚙]  │
├────────────────┬─────────────────────────────────────────────┤
│                │  ┌──────────┬──────────┬───────┐            │
│  HOSTS         │  │core-sw-01│ rtr-02 ✕ │   +   │            │
│  CREDENTIALS   │  └──────────┴──────────┴───────┘            │
│  LOGS          │                                             │
│  QUICK CONNECT │            main content area                │
│                │                                             │
│      20%       │                    80%                      │
│                │                                             │
├────────────────┴─────────────────────────────────────────────┤
│  core-sw-01 · ssh · connected · logging          10.1.1.5:22 │
└──────────────────────────────────────────────────────────────┘
```

- Sidebar defaults to 20% width, is draggable between 15–35%, and collapses to an icon rail.
- Nav items are uppercase, letter-spaced, `--text-secondary`; the active item gets `--accent-muted` background and `--accent` text.
- Status bar at the bottom shows connection state, protocol, and a logging indicator (a small red dot when actively writing).

### 6.3 Sidebar sections

**Hosts** — a folder tree. Folders expand/collapse; hosts show a protocol icon, friendly name, and address in `--text-tertiary`. Double-click connects. Right-click: Connect, Connect in new tab, Edit, Duplicate, Delete. A search field at the top filters by name and address.

**Credentials** — flat list, name plus type badge (`password` / `key`). Never displays a secret. Editing a password shows an empty field with placeholder "Unchanged."

**Logs** — a tree mirroring the log directory: device folders, expanding to dated session files with size and duration. Selecting one opens it in the main pane as a read-only monospace viewer with search (Cmd/Ctrl+F) and a "Reveal in file manager" button. **The viewer must be virtualised** — a `show tech-support` log can be tens of megabytes.

**Quick connect** — a form in the main pane, not a saved entry: protocol toggle, address, port, username, password/key, and a note that nothing will be saved. Logging is on and writes to `_quick/`. Recent quick connections persist in memory for the app session only.

### 6.4 Sessions

Tabs across the top of the main pane. Dragging a tab onto the left, right, top, or bottom edge of the terminal area splits the pane in that direction (this is what `dockview` gives you). Each pane holds one session.

Session toolbar (right-aligned, minimal): reconnect, clear, search, send break (serial only), close.

xterm theme derives from the tokens above:

```ts
const theme = {
  background: '#0A0A0B',
  foreground: '#F5F5F7',
  cursor: '#E5484D',
  selectionBackground: 'rgba(229, 72, 77, 0.28)',
  black: '#1B1B1F',   brightBlack:   '#6A6A72',
  red: '#E5484D',     brightRed:     '#F2555A',
  green: '#3DD68C',   brightGreen:   '#56E39F',
  yellow: '#F5A623',  brightYellow:  '#FFBF47',
  blue: '#5B9DF5',    brightBlue:    '#7DB3F7',
  magenta: '#C678DD', brightMagenta: '#D89BE8',
  cyan: '#4CC9C0',    brightCyan:    '#6FDDD5',
  white: '#D8D8DE',   brightWhite:   '#FFFFFF',
};
```

Connection failures render inside the terminal pane in `--status-error`, showing the retry ladder that was attempted and the server's offered algorithms — not a modal.

### 6.5 Forms

**Add / Edit Host:** Friendly name · Protocol (SSH / Telnet / Serial) · Folder (existing or create new) · then protocol-conditional fields — address and port for SSH/Telnet, the serial block for Serial · Credential (dropdown of saved credentials, or "Specify for this device" revealing inline fields) · Log all sessions (toggle, default on).

**Add / Edit Credential:** Name · Type (Password / SSH key) · Username · then password field, or key path with a file picker plus optional passphrase.

Errors appear inline under the offending field. Buttons are verbs: "Add host", "Save changes", "Connect".

---

## 7. Export / import

Two separate actions in Settings.

**Export configuration** → `ns3h-config-YYYY-MM-DD.json`
Hosts, folders, and settings. No credentials, no secrets, no known-hosts. Plain readable JSON, safe to email or commit.

**Export configuration and credentials** → `ns3h-backup-YYYY-MM-DD.ns3h`
Everything above plus credential entries and their secrets. Prompts for a passphrase at export.

- Key derivation: Argon2id (m=64MB, t=3, p=4) — use `@node-rs/argon2`
- Encryption: AES-256-GCM
- Header carries version, salt, and nonce in cleartext; everything else is ciphertext

Private keys are **never** included — only the `keyPath` reference. On import, any credential whose key file is missing at the recorded path is flagged in the UI with a "Locate key" action.

**Import** accepts either format. It merges rather than replacing: new IDs are added, colliding IDs prompt with a per-item keep/overwrite choice. Never silently clobber an existing config.

---

## 8. Repository layout

```
ns3h/
├── electron.vite.config.ts
├── package.json
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── ipc/               # typed channel handlers
│   │   ├── ssh/
│   │   │   ├── algorithms.ts
│   │   │   ├── connection.ts  # retry ladder, auth, host keys
│   │   │   └── sftp.ts
│   │   ├── telnet/
│   │   │   ├── connection.ts
│   │   │   └── iac.ts
│   │   ├── serial/connection.ts
│   │   ├── logging/
│   │   │   ├── writer.ts
│   │   │   └── sanitize.ts    # ANSI strip + overwrite resolution
│   │   ├── store/             # JSON read/write, migrations
│   │   ├── secrets/           # safeStorage wrapper
│   │   └── transfer/          # export/import
│   ├── preload/index.ts
│   └── renderer/
│       ├── App.tsx
│       ├── components/
│       │   ├── Sidebar/
│       │   ├── Terminal/
│       │   ├── LogViewer/
│       │   ├── Forms/
│       │   └── Settings/
│       ├── stores/
│       └── styles/tokens.css
└── build/                     # icons, entitlements
```

---

## 9. Build and distribution

`electron-builder`, unsigned. Targets: `AppImage` and `.deb` (Linux), `.exe` NSIS (Windows), `.dmg` (macOS).

**Native modules.** `serialport` must be rebuilt per platform via `electron-rebuild`. There is no cross-compilation — each target needs a build on its own OS (GitHub Actions matrix, or three local machines).

**Unsigned install notes for the README:**

- macOS — Gatekeeper blocks it. The user opens System Settings → Privacy & Security → "Open Anyway" after the first launch attempt, or runs `xattr -dr com.apple.quarantine /Applications/NS3H.app`.
- Windows — SmartScreen warns. "More info" → "Run anyway."
- Linux — `chmod +x` the AppImage.

---

## 10. Build order

Each phase should be independently runnable and testable.

| Phase | Scope | Done when |
|---|---|---|
| **0** | Scaffold: electron-vite, TS, IPC bridge, window chrome, design tokens | Empty themed window with sidebar shell |
| **1** | SSH core: algorithm lists, retry ladder, auth, host key trust, xterm.js wiring | Can connect to a Linux box and an old switch from a hard-coded config |
| **2** | Config store: JSON files, migrations, `safeStorage` secrets | Hosts and credentials persist across restarts |
| **3** | Hosts and Credentials UI: tree, forms, folders | Full CRUD from the interface |
| **4** | Logging: sanitiser, writer, folder rules, header block | Sessions produce clean, readable `.log` files |
| **5** | Telnet + Serial: IAC negotiation, port enumeration, send break | Console cable and telnet device both work |
| **6** | Tabs and drag-to-split | Multiple concurrent sessions, split panes |
| **7** | Log browser: tree, virtualised viewer, search | Can read any past session in-app |
| **8** | Quick connect | Ephemeral sessions logging to `_quick/` |
| **9** | SFTP/SCP: dual-pane transfer for SSH sessions | Can move files to and from a Linux host |
| **10** | Export / import: both formats | Round-trips config to a second machine |
| **11** | Packaging: electron-builder, CI matrix, README | Installers for all three platforms |

**Phase 1 is the risk.** Test it against the oldest device available before building anything on top of it. If `ssh2` can't negotiate with real legacy gear, everything downstream changes.

---

## 11. Acceptance checks

- Connects to OpenSSH 9.x with modern crypto (verify: log header shows curve25519 / chacha20 or AES-GCM)
- Connects to a device offering only `diffie-hellman-group1-sha1`, `ssh-dss`, `3des-cbc`
- Legacy retry fires and succeeds when the full proposal is rejected
- `keyboard-interactive` authentication works against a TACACS+-backed device
- A paged `show running-config` produces a readable log with no backspace artifacts
- A 50 MB log opens in the viewer without freezing the UI
- Serial connects at 9600 8N1; Send Break interrupts a booting router
- Host key change triggers the comparison modal
- Config export imports cleanly on a second machine; encrypted bundle restores credentials
- Session keeps logging while its tab is backgrounded
