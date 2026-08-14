# NS3H

A cross-platform terminal client for network engineers. It connects to anything — modern Linux
hosts, 20-year-old Cisco switches, serial consoles, telnet-only gear — without the user ever
configuring a cipher.

See [`NS3H-design-spec.md`](./NS3H-design-spec.md) for the full brief.

## Status

Phases 0 through 3 of the build order are in place.

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold: electron-vite, TS, IPC bridge, window chrome, design tokens | done |
| 1 | SSH core: algorithm ladder, auth, host key trust, xterm.js wiring | done |
| 2 | Config store: JSON files, migrations, `safeStorage` secrets | done |
| 3 | Hosts and Credentials UI: tree, forms, folders | done |
| 4 | Logging: sanitiser, writer, folder rules, header block | not started |
| 5+ | Telnet, serial, tabs/splits, log browser, quick connect, SFTP, export, packaging | not started |

What works today: quick-connect SSH from the main pane, the full → legacy algorithm retry ladder,
password / public-key / keyboard-interactive authentication with inline re-prompting, host key
trust-on-first-use with a changed-key comparison modal, and a live xterm.js session with a WebGL
renderer.

Saved hosts and credentials have full CRUD from the sidebar: a folder tree with search, a
credentials list, and add/edit forms with inline per-field validation. Double-click a host to
connect — its credential and secret are resolved in the main process, never handed to the
renderer. Config persists in `~/.config/ns3h/` (or the platform equivalent), with secrets in the
OS keychain via `safeStorage`.

Telnet and serial hosts can be saved and edited now; connecting them arrives in phase 5.

Sessions are not yet written to disk — that is phase 4.

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
time. The primes are checked byte-for-byte against OpenSSL's own copies in the unit tests.

Probed under Electron 33 / BoringSSL: `modp1` and `modp2` are missing and now shimmed; `modp5`,
`modp14`–`modp18`, `3des-cbc`, all AES CBC/CTR modes, `blowfish-cbc`, `rc4`, `hmac-sha1` and
`hmac-md5` are all present. `cast5-cbc` is absent, but `ssh2` does not implement `cast128-cbc`
anyway.

## Algorithm coverage

The proposal in `src/main/ssh/algorithms.ts` is the spec's list verbatim, offered in a fixed
preference order with no user-facing settings. It is intersected at connect time with what `ssh2`
actually implements, because `ssh2` throws on an algorithm name it does not know.

`ssh2` 1.17 does **not** implement four ciphers the spec asks for: `blowfish-cbc`, `cast128-cbc`,
`arcfour256`, `arcfour128`, and `arcfour`. They stay in the list — if `ssh2` gains them, they are
offered automatically — and NS3H prints one line in the session pane naming what it could not
offer, rather than dropping them silently. Everything else in the spec, including
`diffie-hellman-group1-sha1`, `ssh-dss`, `3des-cbc`, and `hmac-md5`, is available.

Gear that only speaks arcfour or blowfish will need a different SSH transport — worth knowing
before phase 1 is signed off against real hardware.

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
    store/     hosts, credentials, settings, known-hosts — versioned JSON, atomic writes
    secrets/   safeStorage wrapper over secrets.enc
    sessions/  per-renderer session registry and prompt correlation
    ipc/       typed channel handlers
  preload/     contextBridge API, sandboxed
  renderer/    React UI
shared/        types and channel names used by all three
```
