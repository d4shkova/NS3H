# Building NS3H

A checklist per platform. Installers land in `release/`.

**There is no cross-compilation.** Each installer is built on its own OS — three machines, or the
GitHub Actions matrix in `.github/workflows/build.yml`, which does all three on every push and
uploads the results as artifacts.

---

## All platforms

```sh
git clone https://github.com/d4shkova/NS3H.git
cd NS3H
git checkout claude/ns3h-design-spec-review-ywidhw
npm install
npm test          # 190 tests, no hardware needed
npm run dev       # run it
npm run dist      # build installers for the platform you are on
```

Node 20 or newer. Nothing needs compiling — `serialport` ships Node-API prebuilds, so
`electron-rebuild` and a C++ toolchain are **not** required on any platform.

---

## Linux (CachyOS / Arch)

```sh
sudo pacman -S --needed nodejs npm git
# Present on a normal desktop install; harmless to run anyway:
sudo pacman -S --needed gtk3 nss alsa-lib libxss libxshmfence mesa

npm install
npm run dist:linux     # AppImage + .deb in release/
```

**If npm blocks install scripts** (the default on recent npm), Electron's binary never downloads
and `npm run dev` fails with `Electron uninstall`:

```sh
npm install-scripts approve electron
npm install
npx electron -v        # expect v33.4.11
```

Leave `ssh2` and `cpu-features` blocked — `ssh2` works fine without the optional native addon, and
approving it just invites `node-gyp` errors.

**Serial ports** need group membership:

```sh
sudo usermod -aG dialout $USER    # log out and back in
```

**Running the AppImage:**

```sh
chmod +x release/NS3H-*.AppImage
./release/NS3H-*.AppImage
```

On a system without FUSE, prefix it: `APPIMAGE_EXTRACT_AND_RUN=1 ./release/NS3H-*.AppImage`

**Installing the deb:** `sudo apt install ./release/ns3h_*.deb` (Debian/Ubuntu targets).

---

## Windows

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
# restart the terminal so PATH updates

git clone https://github.com/d4shkova/NS3H.git
cd NS3H
git checkout claude/ns3h-design-spec-review-ywidhw
npm install
npm run dist:win       # NSIS .exe in release\
```

No Visual Studio build tools are needed — nothing compiles.

**Installing:** the build is unsigned, so SmartScreen warns. Choose **More info → Run anyway**.

**Serial ports** are `COM1`, `COM3`, … and need no group membership. A USB adapter's driver
(FTDI, Prolific, CH340) must be installed, as it would be for PuTTY.

---

## macOS

```sh
xcode-select --install         # for git, if not already present
brew install node

git clone https://github.com/d4shkova/NS3H.git
cd NS3H
git checkout claude/ns3h-design-spec-review-ywidhw
npm install
npm run dist:mac       # .dmg in release/
```

Builds a `.dmg` for the architecture you are on. For both, run it twice — once on an Intel Mac and
once on Apple silicon — or add `--x64 --arm64` to build a universal binary (slower, larger).

**Installing:** unsigned, so Gatekeeper blocks it. After the first launch attempt, open
**System Settings → Privacy & Security → Open Anyway**. Or clear the quarantine flag directly:

```sh
xattr -dr com.apple.quarantine /Applications/NS3H.app
```

**Serial ports** appear as `/dev/tty.usbserial-*` and need no group membership.

**Untested:** macOS packaging is configured but has never been run. The likeliest snag is the icon
— `build/icon.png` is a 512×512 placeholder, and macOS may want a proper `.icns`. If the build
complains, generate one with `iconutil` or replace `build/icon.png` with a designed 1024×1024.

---

## Building everything at once

Push to the branch and let CI do it:

```
.github/workflows/build.yml
```

It typechecks and tests once on Ubuntu, then packages on `ubuntu-latest`, `windows-latest` and
`macos-latest` in parallel. Download the installers from the run's **Artifacts** section.
`fail-fast` is off, so one platform breaking still tells you about the other two.

---

## Where things go

| Path | What |
|---|---|
| `release/` | Built installers (git-ignored) |
| `out/` | Compiled app, rebuilt automatically before packaging |
| `~/.config/ns3h/` | Config, on Linux. macOS: `~/Library/Application Support/ns3h/`. Windows: `%APPDATA%\ns3h\` |

Config is plain JSON and hand-editable. Secrets live in the OS keychain, never in those files.

---

## If a build fails

| Symptom | Cause |
|---|---|
| `Electron uninstall` | Install scripts were blocked — see the Linux section; the fix is the same everywhere |
| `Cannot find module 'dockview'` | `npm install` was not run after pulling |
| `EACCES` opening a serial port | Not in `dialout` (Linux only) |
| `Please specify author 'email'` | `package.json` was edited and lost its `author` field; the `.deb` target requires it |
| Native module not found in a packaged build | `asarUnpack` in `electron-builder.yml` was changed — the serialport binding must stay outside the asar |
