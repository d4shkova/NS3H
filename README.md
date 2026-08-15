# NS3H

A cross-platform terminal client for network engineers. It connects to anything — modern Linux
hosts, 20-year-old Cisco switches, serial consoles, telnet-only gear — without the user ever
configuring a cipher.

See [`NS3H-design-spec.md`](./NS3H-design-spec.md) for the full brief.

## Status

All eleven phases of the build order are in place.

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold: electron-vite, TS, IPC bridge, window chrome, design tokens | done |
| 1 | SSH core: algorithm ladder, auth, host key trust, xterm.js wiring | done |
| 2 | Config store: JSON files, migrations, `safeStorage` secrets | done |
| 3 | Hosts and Credentials UI: tree, forms, folders | done |
| 4 | Logging: sanitiser, writer, folder rules, header block | done |
| 5 | Telnet + serial: IAC negotiation, port enumeration, send break | done |
| 6 | Tabs and drag-to-split | done |
| 7 | Log browser: tree, virtualised viewer, search | done |
| 8 | Quick connect | done |
| 9 | SFTP: dual-pane transfer for SSH sessions | done |
| 10 | Export / import: both formats | done |
| 11 | Packaging: electron-builder, CI matrix, README | done |

What works today: quick-connect SSH from the main pane, the full → legacy algorithm retry ladder,
password / public-key / keyboard-interactive authentication with inline re-prompting, host key
trust-on-first-use with a changed-key comparison modal, and a live xterm.js session with a WebGL
renderer.

Saved hosts and credentials have full CRUD from the sidebar: a folder tree with search, a
credentials list, and add/edit forms with inline per-field validation. Double-click a host to
connect — its credential and secret are resolved in the main process, never handed to the
renderer. Config persists in `~/.config/ns3h/` (or the platform equivalent), with secrets in the
OS keychain via `safeStorage`.

All three protocols connect: SSH, telnet, and serial, from Quick connect or a saved host.

Sessions are logged to disk automatically, cleaned for readability, and can be read back in the
app: the Logs view lists one folder per device, and opening a session shows it in a virtualised
viewer with search. A quarter-million-line log renders 120 rows at a time.

## Themes

Settings carries a theme picker: fourteen palettes, each previewed as a miniature terminal in
its own colours. NS3H Dark and Light, Kanagawa (Wave, Dragon, Lotus), Everforest (dark and
light), Night Owl and Light Owl, Flexoki (dark and light), and three high-contrast Hacker
palettes. They are NS3H's own renderings of well-known colour schemes, not copies of any
client's assets.

A theme carries **both halves** — the app's design tokens and the terminal's 16-colour palette —
in one object (`shared/themes.ts`). Keeping them together is what stops the chrome and the
session output drifting apart; a light interface wrapped around a black terminal reads as a bug.
Switching repaints open sessions, not just new ones, and the app's own lines (connection banners,
failures) use the theme's status colours rather than fixed ones.

Applying a theme writes its tokens onto the document root, so everything styled through the
tokens follows automatically — including dockview, whose variables are mapped onto them. Only
terminals need telling, which the registry subscribes for. An unknown theme id in a hand-edited
settings file falls back to the default instead of leaving the app unstyled.

The tests assert every theme defines every token and the full palette, that a light theme's
terminal background matches its chrome, and that foreground and background stay far enough apart
to read — a broken palette fails there rather than in front of you.

## The home screen

The app opens on a card grid — Quick connect, Hosts, Credentials, Logs, SFTP/SCP — each showing
live counts, and each opening that thing as a list in the main pane. The sidebar mirrors it: the
same entry drives both panels. Sessions keep running (and logging) behind whatever is on screen;
a "back to sessions" control returns to the dock.

## Terminal clipboard

Selecting text in a session copies it. Right-click pastes.

A paste of more than one line is confirmed first, showing the lines that are about to run,
because each one takes effect on arrival and a device has no undo. The warning can be turned off
in Settings, or from the dialog itself.

Clipboard access goes through the main process rather than `navigator.clipboard`: in a sandboxed
renderer that API is gated on focus and permissions, which is not a dependency a terminal paste
can carry.

## Export and import

Two separate actions in Settings, because they have different consequences.

**Export configuration** writes hosts, folders and settings as readable JSON — no credentials, no
secrets, no known-hosts. Safe to email or commit.

**Export with credentials** adds the credential list and its secrets, encrypted under a
passphrase: Argon2id (m=64MB, t=3, p=4) for the key, AES-256-GCM for the payload. Version, salt
and nonce sit in the header in the clear; everything else is ciphertext. The KDF parameters are
read back from the header rather than assumed, so a later change to the defaults cannot strand an
old backup. Private keys are never included — only the path recorded for them, and a key that is
not where the backup says it is gets flagged on import.

**Import accepts either format and merges rather than replacing.** New ids are added; a colliding
id is listed with what is here and what would replace it, and nothing is overwritten unless it is
ticked. A wrong passphrase says so — GCM authentication cannot distinguish that from a tampered
file, and the message does not pretend otherwise.

## File transfer

**File transfer** is its own entry in the sidebar, and the pane takes one of three sources:

- **An open SSH session**, over **SFTP or SCP** — a toggle in the toolbar, because which one
  works is the device's decision and not worth a reconnect to find out. Either rides the session
  that is already up, so the transfer costs no second authentication and reuses the crypto
  negotiated for the shell.
- **SFTP or SCP on its own connection.** No CLI session needed — enter an address and
  credentials and the pane connects for itself. This is the same `SshConnection` a terminal
  session uses, opened with `shell: false`, so it gets the identical algorithm ladder,
  known-hosts check and host-key modal; it simply never asks for a shell channel.
- **SMB.** A Windows or Samba share, attached by `\\host\share`.

**SCP exists here because SFTP often is not there.** A great deal of network gear runs an SCP
server and no SFTP subsystem at all — on IOS, `ip scp server enable`, with no equivalent for
SFTP — so the SFTP channel is refused and SCP is the only way in. When a session's SFTP channel
is refused, the error carries a **Try SCP instead** button rather than making you work that out.

ssh2 has no SCP, so the protocol is implemented in `src/main/files/scpProtocol.ts`: a control
line, an acknowledgement byte, the file's bytes, another acknowledgement. It is split from the
transport so it can be tested, and it is tested twice — against a scripted device in
`tests/scp.test.ts`, and against OpenSSH's own `scp -f` and `scp -t` in
`tests/scpInterop.test.ts`, which is the check that counts: the protocol is undocumented by
design and the only authority on it is the implementation everything else talks to. The interop
test skips itself where OpenSSH is not installed.

**SCP cannot list a directory** — there is no listing operation in the protocol. NS3H runs `ls`
to fill the remote pane, which works on anything POSIX and does not work on a switch, because a
switch has no `ls`. That is reported as what it is, and the pane falls back to a path you type:
uploads go to the directory in the box, and a full path plus **Fetch** pulls a file down. Which
is how a firmware image gets moved anyway.

Two more things SCP does differently, both deliberate:

- **Paths are not quoted unless they need it.** A POSIX server runs the path through a shell;
  `flash:c2960-image.bin` on IOS is handed to something that is not a shell and would take the
  quotes literally. Paths made only of characters no shell treats specially go untouched, which
  covers every network-device path; anything else is single-quoted.
- **A refusal arrives late.** SCP's verdict on an upload comes after the last byte, so
  `No space left` on a switch with a full flash appears once the whole image has crossed the
  wire. Nothing can be done about that — it is the protocol — but it is worth expecting.

A standalone target is **not saved**, the way Quick connect is not: it is used for that
connection and forgotten. A saved credential can be picked instead of typing a password — the
secret is resolved in main, so the renderer neither sends nor receives one.

Telnet and serial sessions say so rather than offering a transfer they cannot carry.

**What a standalone SFTP connection cannot do:** answer a multi-prompt challenge. A session
puts an authentication prompt in its terminal; a standalone connection has no terminal and no
tab to anchor one to, so the password from the form answers the first round and anything beyond
that fails with a message rather than waiting on a modal that cannot appear. A device demanding
a second factor has to be reached by opening an SSH session and transferring over it.

**SMB is SMB2 only.** `@tryjsky/v9u-smb2` is a pure-JS client — no native module, so it packages
on all three platforms — and it speaks SMB2. A host offering only SMB1 (an old NAS, or a box
with SMB2 switched off) reports `STATUS_NOT_SUPPORTED`, which NS3H translates into that
sentence rather than the status code. The other codes worth naming — a bad password, a missing
share, a share the account cannot reach — are translated too.

**A device with no SFTP subsystem is the normal case, not a fault.** This applies to a session's
SFTP channel; a standalone SFTP connection to the same device fails the same way, for the same
reason. Most switches and routers
run an SSH server without one, and ssh2 reports that as a bare `Channel open failure:` with no
reason attached. NS3H names the device, keeps whatever reason it did give, and says what to check
(`ip ssh server sftp` on IOS) — and drops the ssh2 stack, which pointed at protocol internals for
something the device did deliberately. The channel is opened once per session and shared: the
home lookup and the first listing arrive together, and one refusal is reported once, not twice.

## Startup output

`npm run dev` prints some lines that are worth knowing the origin of:

- **`Fontconfig warning: ... invalid attribute 'xsi:nil'`** — not NS3H, and not Electron either.
  These come from the system's own `/etc/fonts/conf.d` files being parsed by Chromium's fontconfig;
  recent Fedora ships configs that its fontconfig build then complains about. They are harmless,
  there is nothing in this repository that produces or can suppress them, and they do not appear
  in a packaged build launched from a desktop entry.
- **`NS3H: restored DH groups this runtime is missing — modp1, modp2`** — ours, and informational.
  It confirms the BoringSSL shim below is active, which is what makes `diffie-hellman-group1-sha1`
  work against pre-2010 gear. Its absence on some other runtime would mean the groups were native.

## Panes and terminal ownership

The session area is `dockview`: tabs across the top, and dragging a tab to an edge of
the terminal area splits the pane that way (§6.4). Its vanilla API is used rather than its
React bindings, for a specific reason.

**Terminals are owned by a registry outside React** (`renderer/terminals/registry.ts`), keyed
by session id. Moving a panel between groups unmounts and remounts whatever renders it — with a
React-owned xterm, every drag would dispose the terminal and take the scrollback with it. The
session itself would survive, since it lives in main, but the screen would go blank. Instead each
terminal owns a detached element that panes adopt and release, so a drag is a DOM re-parent and
the terminal never notices.

That ownership split is also why status handling lives at the app level rather than in a pane
component: a pane can be unmounted mid-session at any moment.

dockview only mounts the visible panel, so panes re-fit on their own resize, on layout change,
and on re-attach — a terminal that is not re-fitted keeps a stale column count and wraps.

## Telnet and serial

**Telnet** is a hand-written IAC state machine (`telnet/iac.ts`) — there is no adequate library.
It agrees to exactly four options (ECHO, SUPPRESS-GO-AHEAD, TERMINAL-TYPE, NAWS), refuses
everything else, answers a TERMINAL-TYPE subnegotiation with `xterm-256color`, and sends NAWS on
connect and on every resize. It never answers a request that would not change the current state,
which is what stops two polite implementations negotiating at each other forever. Outbound `0xFF`
is escaped as `IAC IAC`, and inbound `IAC IAC` is unescaped back to one byte.

**Serial** uses `serialport`. Contrary to the spec's §9 note, **no `electron-rebuild` is needed**:
serialport 13 ships Node-API prebuilds, which are ABI-stable across Node and Electron. Verified by
loading the binding inside a running Electron build, and by installing with `--ignore-scripts` —
so an npm that blocks install scripts still works.

`SerialPort.list()` shells out to `udevadm` and throws where it is absent (containers, minimal
installs), so port enumeration falls back to reading `/dev` directly rather than surfacing an
error. The list refreshes on demand, since adapters get plugged in mid-session, and free-text
entry is always available.

Send Break asserts the line for 250 ms — the sequence Cisco password recovery needs. A permissions
failure names the fix (`usermod -aG dialout $USER`, then log out and back in) instead of printing
`EACCES`.

## Logging

Logging happens in the **main process, on the raw stream**, not in the renderer. A session keeps
logging with its tab backgrounded, its terminal destroyed, or no terminal ever created — verified
by driving a session that has no xterm attached at all.

What lands in the file is what the user saw, not what came down the wire. `logging/sanitize.ts`
runs a streaming state machine that strips ANSI escapes and replays backspace, carriage-return
and erase-in-line into a one-line buffer, emitting a line only once the device leaves it. That is
what turns a paged `show running-config` — full of `--More--` prompts the device rubs out with
backspaces — into something readable. Chunk boundaries fall anywhere, including mid escape
sequence and mid UTF-8 character, so the tests split the same input at every possible offset and
assert the result never changes.

Commands appear in the log because the device echoes them; no keystroke capture is involved,
which is also why passwords stay out — echo is suppressed at password prompts.

Writes are buffered and flushed every two seconds, on session close, and on app quit (quit is
deferred until the buffers reach disk).

## Secrets and the keychain

Passwords and key passphrases go to the OS keychain (Keychain / DPAPI / libsecret) and land in
`secrets.enc`. Private keys are never copied — only the path to them is stored.

When no keychain is available — a minimal Linux desktop with no keyring running — Electron's
fallback is barely-obfuscated plaintext. NS3H refuses to write in that case rather than implying a
security property it cannot deliver: `snapshot().secrets` reports it with a reason for the UI to
show, and affected sessions prompt for the credential instead. On KDE that means `kwallet`, on
GNOME `gnome-keyring`.

## Running it

```sh
npm install
npm run dev        # electron-vite dev server with HMR
npm run build      # typecheck + production bundle into out/
npm start          # preview the production bundle
npm test           # vitest unit tests
```

## Building installers

Step-by-step per platform, including the platform-specific traps: [`BUILDING.md`](./BUILDING.md).

```sh
npm run dist          # for the platform you are on
npm run dist:linux    # AppImage + .deb
npm run dist:win      # NSIS .exe
npm run dist:mac      # .dmg
```

Output lands in `release/`. Packaging runs the production build first, so
`npx electron-builder` on its own cannot ship a stale renderer.

**There is no cross-compilation** — each target is built on its own OS. `.github/workflows/build.yml`
does that as a matrix (Ubuntu, Windows, macOS) after typecheck and tests, and uploads the
installers as artifacts. Three local machines work equally well.

`serialport` needs no rebuild per platform (Node-API prebuilds), but its binding is kept outside
the asar via `asarUnpack` — inside one, the loader cannot find it.

## Installing an unsigned build

Builds are unsigned, so each platform will object once. This is expected, not a fault:

- **macOS** — Gatekeeper refuses it. Open System Settings → Privacy & Security and choose
  "Open Anyway" after the first launch attempt, or run
  `xattr -dr com.apple.quarantine /Applications/NS3H.app`.
- **Windows** — SmartScreen warns. Choose "More info", then "Run anyway".
- **Linux** — `chmod +x NS3H-*.AppImage` and run it. The `.deb` installs normally with
  `sudo apt install ./ns3h_*.deb`. On a system without FUSE, run the AppImage with
  `APPIMAGE_EXTRACT_AND_RUN=1`.

Serial ports need group membership on Linux: `sudo usermod -aG dialout $USER`, then log out and
back in. NS3H says this itself if a port refuses to open.

## Electron's crypto is BoringSSL

Worth knowing before debugging anything crypto-shaped: Electron does not link OpenSSL, it links
BoringSSL, and BoringSSL omits things OpenSSL has. Code that works under `node` can still fail in
the app.

The one that bit us: `crypto.createDiffieHellmanGroup('modp2')` throws `Unknown DH group` in
Electron. That is the 1024-bit group behind `diffie-hellman-group1-sha1` — for a lot of pre-2010
gear, the only key exchange on offer — so those devices failed both rungs of the ladder with
"Unknown DH group" while a plain Node script connected fine.

`src/main/ssh/legacyDh.ts` restores the missing groups by handing BoringSSL the standard MODP
primes explicitly, which it accepts. `src/main/ssh/ssh2.ts` is the only place ssh2 may be loaded
from, because the shim has to be installed *before* ssh2 captures the crypto function at require
time. The shim runs in that module's body; the ssh2 require itself is deferred to the first SSH
operation, which keeps ~60 ms of native-binding load off the path to the first window without
changing the ordering the shim depends on. The primes are checked byte-for-byte against OpenSSL's
own copies in the unit tests.

`serialport` and `@node-rs/argon2` are loaded the same way — on first use, not at startup. Both
are native modules, neither is needed to open a window, and between the three roughly 90 ms of
module loading no longer happens before the app can paint.

Probed under Electron 33 / BoringSSL: `modp1` and `modp2` are missing and now shimmed; `modp5`,
`modp14`–`modp18`, `3des-cbc`, all AES CBC/CTR modes, `blowfish-cbc`, `rc4`, `hmac-sha1` and
`hmac-md5` are all present. `cast5-cbc` is absent, but `ssh2` does not implement `cast128-cbc`
anyway.

## Algorithm coverage

The proposal in `src/main/ssh/algorithms.ts` is the spec's list verbatim, offered in a fixed
preference order with no user-facing settings. It is intersected at connect time with what `ssh2`
actually implements, because `ssh2` throws on an algorithm name it does not know.

`ssh2` builds its supported-cipher list from whatever the runtime's crypto actually provides, so
the answer differs between Electron and plain Node — and the app is what matters:

| Cipher | Electron (the app) | Node (scripts, tests) |
|---|---|---|
| `blowfish-cbc`, `arcfour256`, `arcfour128`, `arcfour` | available | missing |
| `chacha20-poly1305@openssh.com` | missing | available |
| `cast128-cbc` | missing | missing |

So the legacy ciphers the spec asks for are all offered by the running app; BoringSSL provides
blowfish and RC4. What it lacks is chacha20, which costs nothing — a modern server negotiates
AES-GCM instead. `cast128-cbc` is the only entry in the spec's list that is genuinely unavailable,
and gear that speaks nothing but CAST is the one case that would need a different transport.

Whatever cannot be offered is named in one grey line in the session pane, rather than dropped
silently, so the proposal is always inspectable at connect time.

## Testing against a legacy server locally

`ssh2` can act as a server, which makes it possible to reproduce antique gear without antique
gear. A server constrained to `diffie-hellman-group1-sha1` / `ssh-rsa` / `3des-cbc` / `hmac-sha1`
is enough to exercise the whole legacy path, and is how the BoringSSL DH problem above was
confirmed fixed inside a running Electron build.

## Verifying phase 1 against real gear

Phase 1 is the risk in this build. The unit tests cover the pure logic (algorithm ordering and
filtering, failure classification, known-hosts trust decisions, fingerprint formatting), and the
app has been smoke-tested end to end for boot, IPC round-trip, and failure rendering. The parts
that need real devices:

- OpenSSH 9.x — confirm the status bar reports curve25519 with chacha20 or AES-GCM
- A device offering only `diffie-hellman-group1-sha1` / `ssh-dss` / `3des-cbc`
- A device that rejects an oversized KEXINIT, to confirm the legacy rung fires and succeeds
- `keyboard-interactive` against a TACACS+-backed device
- A host key change, to confirm the comparison modal appears

## Layout

```
src/
  main/        Electron main process — all ssh2/net/fs work lives here
    ssh/       algorithm policy, retry ladder, host key identity, error classification
    telnet/    IAC option negotiation and the socket wrapper
    serial/    port enumeration with a /dev fallback, break, error translation
    store/     hosts, credentials, settings, known-hosts — versioned JSON, atomic writes
    secrets/   safeStorage wrapper over secrets.enc
    logging/   ANSI/overwrite sanitiser, buffered writer, folder and header rules
    sessions/  per-renderer session registry and prompt correlation
    ipc/       typed channel handlers
  preload/     contextBridge API, sandboxed
  renderer/    React UI
    terminals/ xterm instances, owned outside React so panes can move freely
shared/        types and channel names used by all three
```
