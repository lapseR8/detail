# Detail

**Detail** is a desktop shift-scheduling app by **Campaigner Studios** — drag-and-drop weekly scheduling with one-click screenshot export, for handing a clean schedule to management or the team. Runs fully offline; nothing ever leaves your computer. *(Alpha — actively being built, expect rough edges.)*

Currently macOS only (Apple Silicon).

## Install

1. Download the latest `Detail-<version>-arm64.dmg`.
2. Open it and drag **Detail** into your **Applications** folder.
3. First launch: macOS will likely warn that Detail is from an unidentified developer (it isn't code-signed yet). Right-click (or Control-click) the app in Applications and choose **Open**, then confirm — you only need to do this once. If macOS instead says the app "is damaged and can't be opened," run this once in Terminal, then try again:
   ```bash
   xattr -cr /Applications/Detail.app
   ```

Requires macOS 12 (Monterey) or later.

## Using Detail

Detail has two independent scheduling modes, switchable from the toolbar:

- **Single mode** — one shift per person per time slot, no overlaps. Drag a name from the sidebar onto the grid to create a shift, drag a shift to move it, drag its top/bottom edge to resize, click it for quick edits, or right-click for copy/cut/paste and guard swaps. Switch to **Month view** to jump between pay periods, or use the tabs along the bottom for nearby weeks.
- **Team mode** — up to 10 people scheduled on overlapping shifts the same day. The week view shows a compact color strip per day; click a day to open it full-size for drag/resize/reassign, with a per-day **Clear day** and automatic double-booking prevention.

Both modes support:
- **Undo** — Cmd+Z
- **Keyboard-only shift creation** — Tab to a person, Enter/Space to arm them, Tab to a day, Enter/Space to place a shift
- **Screenshot export** — one click, works fully offline
- **JSON backup / restore** — save your schedule to a file and reload it later

Your data saves automatically as you go — no save button needed.

## Your data

- Everything is stored locally on your Mac — Detail makes no network calls at all.
- Single mode and Team mode keep **completely separate data** — nothing in one can overwrite the other.
- Each mode keeps 60 rolling daily backups automatically, so recovering from an accidental change is usually just a matter of asking.

## Known limitations

- **Unsigned build** — see the install workaround above. No Apple Developer cert yet, so no notarization.
- **Apple Silicon only** — won't run on an Intel Mac.
- **Alpha** — actively changing, features may shift between versions.

---

## For developers

Build from source, project layout, data model, and architecture notes live in [`CLAUDE.md`](./CLAUDE.md) — read that before making changes.

```bash
npm install
npm start          # run in dev
npm run build:arm  # build the macOS .dmg
npm run build:win  # build the Windows installer + portable .exe (unverified on real Windows)
```

Not licensed for redistribution (`"license": "UNLICENSED"` in `package.json`, intentional for now).
