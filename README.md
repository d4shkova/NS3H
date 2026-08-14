# NS3H

A cross-platform terminal client for network engineers. It connects to anything — modern Linux
hosts, 20-year-old Cisco switches, serial consoles, telnet-only gear — without the user ever
configuring a cipher.

See [`NS3H-design-spec.md`](./NS3H-design-spec.md) for the full brief.

## Status

Phases 0 and 1 of the build order are in place.

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold: electron-vite, TS, IPC bridge, window chrome, design tokens | done |
| 1 | SSH core: algorithm ladder, auth, host key trust, xterm.js wiring | done |
| 2 | Config store: JSON files, migrations, `safeStorage` secrets | not started |
| 3 | Hosts and Credentials UI | not started |
| 4 | Logging: sanitiser, writer, folder rules, header block | not started |
| 5+ | Telnet, serial, tabs/splits, log browser, quick connect, SFTP, export, packaging | not started |

What works today: quick-connect SSH from the main pane, the full → legacy algorithm retry ladder,
password / public-key / keyboard-interactive authentication with inline re-prompting, host key
trust-on-first-use with a changed-key comparison modal, and a live xterm.js session with a WebGL
renderer.

Sessions are not yet written to disk — that is phase 4.

## Running it

```sh
npm install
npm run dev        # electron-vite dev server with HMR
npm run build      # typecheck + production bundle into out/
npm start          # preview the production bundle
npm test           # vitest unit tests
```

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
    store/     JSON config on disk (known-hosts today, the rest in phase 2)
    sessions/  per-renderer session registry and prompt correlation
    ipc/       typed channel handlers
  preload/     contextBridge API, sandboxed
  renderer/    React UI
shared/        types and channel names used by all three
```
