# Detail — AI context file (formerly "Hitachi Schedule")

Read this fully before touching anything. This app has broken the same way
twice already because an AI edited it without re-reading the live file first.
Don't be the third.

## What this is

A single-window Electron app: a draggable weekly shift-scheduler for a
corporate security team, Friday–Thursday pay periods. Built to look like
the Google Sheet it replaced, with one-click PNG export for handing the
schedule to management.

## File structure

```
main.js        Electron main process — one BrowserWindow, IPC save/load to disk
preload.js      contextBridge exposing window.scheduleAPI.{load,save} only
index.html      THE ENTIRE APP. All CSS + HTML + JS in one file — two
                independent inline <script> blocks (single-mode, then Team
                mode). ~2400 lines as of v0.84.3, grew from ~1450 when Team
                mode was added; don't be surprised by the size.
vendor/         html2canvas.min.js, vendored so screenshot export works offline
build/          icon.icns goes here (optional — build works without it)
package.json    electron-builder config
README.md       human-facing build instructions
```

There is no bundler, no framework, no build step for the app itself — `index.html`
*is* the source. Don't introduce a framework or split it into modules; that's
a rewrite, not an edit, and nobody asked for one.

## Data model

Everything lives in one `state` object, JSON-serialized to localStorage
(`detailScheduleState_v3`, with a rolling one-slot backup key, plus
`organization`/`title`/`supervisorName`/`supervisorRole` display fields) and
mirrored to disk via `window.scheduleAPI.save()` (Electron main process
writes atomically + keeps 60 rolling daily backups in userData).

```js
state = {
  version: 3,
  currentWeekStart: "YYYY-MM-DD",   // always a Friday — see snapToFriday()
  title, supervisorName, supervisorRole,
  defaultLengthMin: 480,             // default new-shift length
  people: [{id, name, color}],
  weeks: { "<friday-iso>": { shifts: [{id, day, slot, durMin, personId}] } }
}
```

- `day`: 0=Friday … 6=Thursday (NOT JS's native Sunday-first order).
- `slot`: hour offset from `START_HOUR` (7am), i.e. slot 0 = 7:00 AM.
- `durMin`: shift length in minutes.
- Every week is keyed by its own Friday and created lazily via `ensureWeek()`.
  Nothing ever touches another week's data as a side effect.

## Conventions that matter

- `uid()` — random base36, used for every new id. Not cryptographically
  anything, just needs to not collide in one person's shift list.
- `save()` writes localStorage (with a one-deep backup) *and* debounces a
  disk write through `scheduleAPI`. Always call `save()` after mutating
  `state`, before `renderDayCols()`/`renderAll()`.
- `ROW_H` is **not** a constant — `fitRowHeight()` recalculates it on load
  and on window resize so all 24 hour-rows always fit the viewport without
  scrolling. Don't hardcode `34` anywhere; read `ROW_H`.
- Grid lines are real DOM `.grid-line` elements (`addGridLines()`), not a CSS
  background gradient. This is deliberate — html2canvas doesn't reliably
  rasterize repeating CSS gradients, so the lines must be actual elements or
  they silently vanish from exported screenshots.
- `render*()` functions do `wrap.innerHTML = ""` and rebuild from scratch.
  Cheap enough at this data size, but it means **any DOM node you're holding
  a reference to (or that has pointer capture) is destroyed the instant a
  render happens under it.** This is the source of both bugs below.

## The drag/resize architecture — read this before touching `attachMove` or `attachResize`

This has broken from the same root cause **twice**, in two different code
lineages, both times because a fix somewhere else in the app re-triggered a
re-render mid-drag. The current implementation (as of this file) is correct.
If you "simplify" it back toward re-rendering on every `pointermove`, it
**will** break again in the exact same way: card moves one slot, then
freezes solid, and text on the page starts highlighting like a webpage.

**Why it breaks:** `setPointerCapture` ties an element to receive all
subsequent pointer events for that gesture. If that element gets removed
from the DOM (which `wrap.innerHTML = ""` does) or gets `pointer-events:none`
toggled on it mid-gesture, capture is silently dropped. The next
`pointermove` goes nowhere — no error, no event, the drag just dies.
Rendering on every intermediate move (to show live snapping) is exactly what
triggers this, because rendering rebuilds the very element that's captured.

**The fix, in place now:**
1. `pointerdown` on the real card calls `setPointerCapture` and adds
   `pointermove`/`pointerup`/`pointercancel` listeners to **`window`**, not
   the element — immune to whatever ends up under the cursor.
2. The real card is never moved, re-rendered, or given `pointer-events:none`
   during the drag. It's hidden in place (`drag-source-hidden`, `opacity:0`)
   and a disposable **clone** (`.dragging-ghost`) is what actually floats
   with the cursor, `position:fixed`, updated via `requestAnimationFrame`
   (batches to one DOM write per frame, not one per raw pointer event).
3. **Snapping only happens once, in `onUp`** — day/hour are computed from
   the drop coordinates and committed to `state`, then `save()` +
   `renderDayCols()` run exactly once. No state mutation, no render, during
   the float. This is also the correct UX: it should feel like picking the
   card up and setting it down, not like it's teleporting between cells
   while you're still holding it.
4. `pointerdown` also calls `e.preventDefault()`. Without this, the browser
   starts native text-selection on the same mousedown, which both looks like
   the page is "selecting text as if it's a webpage" *and* can race pointer
   capture and break the drag independently of the render issue above.
5. `pointercancel` is handled (not just `pointerup`) so an interrupted
   gesture (e.g. Cmd-Tab mid-drag) can't leave `dragging=true` stuck forever.

`attachResize` follows the identical pattern: live height follows the cursor
via direct style writes (no render), final `durMin` snaps to the nearest
hour and commits only in `onUp`.

**If you need to add live visual snap feedback during drag** (a dashed
"here's where it'll land" outline), that's fine — it was present in an
earlier lineage as `.drop-preview` — but it must be a separate overlay
element positioned directly, never a call to `renderDayCols()`.

## Team Mode (added — read this before touching anything team-*)

A second, fully independent scheduling mode lives in the same `index.html`,
toggled by the Single/Team buttons in the toolbar (`body.team-mode` class).
It lets multiple people (up to 10) be scheduled on overlapping shifts on the
same day — the single-employee mode above intentionally forbids overlap;
team mode is the opposite by design.

**Total isolation, on purpose (this was an explicit requirement):**
- Own data: `teamScheduleAPI` (main.js: `teamSchedule:load`/`teamSchedule:save`,
  file `detail-team-data.json`, backups in `team-schedule-backups/`) and its
  own localStorage key `detailTeamState_v1`. Never touches `scheduleAPI` or
  `detailScheduleState_v3`.
- Own roster (`state.people` inside the team IIFE) — not shared with the
  single-mode roster.
- Own second `<script>` block at the bottom of `index.html`, its own IIFE,
  its own copies of small helpers (`uid`, `snapToFriday`, `fmtLen`, etc).
  It never reads or calls into the single-mode script's closure — can't,
  they're separate scopes — so edits to one cannot break the other by
  accident. Keep it that way; don't hoist shared helpers into a common scope
  "to avoid duplication."
- Own CSS variable `--team-row-h` (fixed 34px, not viewport-fit like
  single-mode's `--row-h`). Do not let team-mode markup reference
  `var(--row-h)` — that's single mode's dynamically-resized variable and
  mixing them was an actual bug caught during initial build.

**How overlap is displayed:**
- Week view (`#team-day-cols`, `.team-day-col-mini`) shows each day as a
  compressed column with thin color slivers, no text.
- Clicking a day (header or mini column) opens `#team-day-overlay`, which
  fills the schedule area with that single day at full size — up to `MAX_LANES`
  (10) fixed `.team-lane` columns, real shift cards with drag/resize/delete/
  click-to-reassign, same ghost-clone commit-on-release drag pattern as single
  mode (`attachTeamMove`/`attachTeamResize`).
  Backdrop click, the ✕ button, or Escape closes it
  (`#team-day-backdrop`/`#team-day-close`).
- **Lane is a persisted, sticky field on each shift** (`shift.lane`, an
  integer 0..9), not recomputed from sort order on every render. This was
  changed from the original design (lane purely derived at render time via a
  greedy interval-pack, `packLanes()` — since removed) after the developer reported
  that dragging a shift vertically (time-only) would visibly swap it into a
  different column, because any change to a shift's start time altered its
  position in the sort-by-start-time order the old packer used every render.
  - `laneConflict(day, lane, slot, durMin, excludeId)` — does a shift at this
    day/lane/time range overlap another shift already in that same lane?
    This, not a global concurrency count, is now the gate for every
    create/move/resize commit.
  - `lowestFreeLane(day, slot, durMin, excludeId)` — used only when a *new*
    shift is created (dropped from the sidebar): auto-picks the lowest open
    column at that time, same "just works" feel as before.
  - `visibleLaneCount(dayShifts)` — purely a rendering concern: how many lane
    columns to draw = highest `.lane` in use that day, +1.
  - **Vertical drag/resize never changes `shift.lane`** — only `slot`/`durMin`.
    If the new time would conflict with another shift already in that same
    lane, the move is rejected and the shift snaps back, exactly like the old
    capacity check used to.
  - **Horizontal drag changes lane explicitly** — `attachTeamMove`'s `onUp`
    checks which `.team-lane` element the pointer was released over (by X
    coordinate) and, if that lane is free at the (possibly also new) time,
    commits the shift into it. Dragging past the rightmost visible lane just
    leaves it in its original lane (no auto-creation of a brand-new column
    via horizontal drag past the edge — only ever lands in an already-
    rendered lane).
  - `normalizeLanesForWeek(week)` — a one-time backward-compatibility
    migration, run once in `load()` and once when reconciling with the disk
    copy. Any shift saved before this change won't have a `.lane` yet; for
    any day where that's true, the *whole day* gets lanes assigned via the
    old greedy pack-by-start-time algorithm, once, and never touched again
    after that.

**Toolbar:** every single-mode toolbar control now has `class="single-only"`;
every team-mode control has `class="team-only"`. CSS handles the show/hide
(`body.team-mode .single-only{display:none}` / the inverse for `.team-only`).
If you add a new toolbar button to either mode, tag it with the right class
or it'll show in both.

**Not built (scope was deliberately kept lean):** no month view, no
screenshot export/copy-image, no manual backup/restore buttons, no
right-click context menu — none of that was requested for Team mode. Single
mode keeps all of it untouched. (Undo *is* now shared behavior — see the
audit-fixes section below.)

**Panel sizing (fixed after initial build):** `#team-day-overlay` was
originally a child of `#team-main`, so its `position:absolute;inset:0`
spanned the sidebar too — the roster was hidden behind the blur exactly
when you needed it most (dragging a person into the day you just opened).
It now lives inside `#team-schedule-wrap` (which needed `position:relative`
added), so it only covers the schedule area — sidebar and toolbar stay live
the whole time. Panel height was also a static `560px`, shorter than the
full 24-row grid at `TEAM_ROW_H` (624px) — `computePanelHeight()` now sets
it explicitly every time a day opens, same pattern as the existing
`computePanelWidth()`. CSS's `max-height:calc(100% - 40px)` is the only
thing still allowed to cap it, as a fallback on a genuinely short window.

**Sizing constants, current as of v0.84.9** (these get tuned by feel most
sessions — don't assume the numbers below are still current without
grepping for them first):
- `TEAM_ROW_H = 34` (day view hour-row height, fixed, not viewport-fit)
- `LANE_MIN_WIDTH = 260`, `LANE_GROWTH = 70` (day panel lane-area width =
  `LANE_MIN_WIDTH + LANE_GROWTH*(lanes-1)`, capped at `MAX_LANES`)
- `--mini-row-h: 30px` (week-view mini column hour-height, CSS var)

**Name abbreviation in the day view:** once more than 3 people are stacked
in the same slot (`laneCount > 3`, passed into `buildTeamShiftEl`), shift
labels switch from the full name to initials via `abbreviateName()` (first
letter of each word, one letter for a single-word name) and the full name
moves to a `title` tooltip. Below 4 concurrent lanes, full names show as
normal — there's room.

## Fixes from the 2026-07-14 third-party audit

An external review (another Claude instance, prompted by the developer with a fresh
read of the whole codebase) found 18 issues, ranked by severity. **Verify
against the live file before trusting this list** — it was caught stale once
already (items below were fixed in a session that never updated this doc).

Fixed, each verified with `node --check` + a real build:
1. **Timezone bug** in every date computation (`toISOString()` silently
   rolls "today" back a day for positive-UTC-offset users) — fixed via a
   shared `toDateStr(d)` helper built from local `getFullYear/Month/Date()`.
2. **Single→Team mode switch left Single's popover/context-menu/custom-panel
   floating on screen** — fixed via one narrow exception to the isolation
   rule: `window.__closeSingleModeFloatingUI`, a single function reference
   Single mode exposes, that Team's `setMode(true)` calls if present.
3. **No confirmation before deleting a person**, despite cascading to
   delete every shift they've ever had, across every week — fixed in both
   modes, message reports the shift count so it's not a blind confirm.
4. **Rebranded defaults** — `defaultState()`/`defaultTeamState()` no longer
   ship with "HITACHI SCHEDULE," the developer's name, or old-employer sample staff
   names baked in.
5. **`localStorage` writes weren't debounced** (only the disk-write path
   was) — every keystroke in the title field re-serialized the entire
   multi-week `state`. Fixed: `writeLocalStorage()` is now debounced 300ms
   same as the disk path, with a synchronous `flushSave()` on
   `beforeunload` so the very last edit isn't lost.
6. **Shallow backup-import validation** — `isValidScheduleBackup()` now
   checks shape, not just truthiness, before accepting a restored file.
7. **Lane numbering in Team mode never compacted** after people were
   removed — the compaction helper (`compactAllLanesInWeek`) existed but
   was only wired into person-removal, not individual shift deletion (the
   audit's actual repro case). Now called from both delete paths.
8. **Undo, fully rebuilt** (was completely absent). Single-level, capped
   20-deep, snapshot-based, independent per mode — `pushUndo()` called
   right before every delete/clear-week/move-commit/resize-commit/
   remove-person commits; Cmd/Ctrl+Z pops the most recent snapshot. No
   redo, no branching history — deliberately simple over building nothing.
9. **Icon-only buttons now have `aria-label`** (✕, ‹, ›, sidebar handles,
   remove-person, delete-shift) in addition to `title`.
10. **`prefers-reduced-motion` respected** via a blanket
    `transition-duration:0.001ms !important` override, rather than hunting
    down each individual transition.
11. **Keyboard-only path to create a shift**, added same day right after
    this doc's "still open" list called it out below (now stale on that
    point specifically). Arm-then-place flow: Tab to a sidebar person,
    Enter/Space arms them (`.armed` outline, `aria-pressed`); Tab to a day,
    Enter/Space drops a default-length shift into the first open gap
    (single mode: `findFirstGap()`, a sorted-shift scan; team mode: hourly
    scan via the existing `lowestFreeLane()`, since team allows overlap).
    Team's day headers are now `tabIndex`-focusable too. **Gotcha:**
    `#team-day-lanes` is a *persistent* node (innerHTML clears each render,
    the node itself doesn't) — its keyboard handler is assigned with
    `.onkeydown =`, not `addEventListener`, specifically to avoid stacking
    a duplicate listener on every re-render. Use the same pattern for any
    future keyboard handler on a persistent team-mode container.

Still open, and likely to stay that way without a larger decision from
the developer (not code problems a session can just fix): unsigned/unnotarized
builds on **both** platforms now (mac needs an Apple Developer cert +
notarization, Windows needs a code-signing cert to avoid the SmartScreen
"unknown publisher" warning — same root cause, no cert bought yet, blocks
selling to anyone who isn't him on either OS); no CI (both builds are
manual, run by hand on one machine each — mac target on the developer's Mac,
Windows target so far only cross-built from the Mac, never yet built on
real Windows); no auto-update mechanism; no EULA (needs an actual lawyer,
not boilerplate); heavy duplication between the two mode scripts (a real
refactor, weighed against the deliberate-isolation architecture above); two
coexisting drag-and-drop systems (HTML5 DnD + hand-rolled pointer
capture) — a valid architecture observation, not something to "fix" without
picking one and rewriting the other.

## Popover positioning + stale-install gotcha — 2026-07-21

- **Single mode's shift popover** could render off the bottom or right edge
  of the screen when clicking a shift near the edge — `showPopover()` only
  ever clamped the top edge (`Math.max(8, rect.top)`) and used a hardcoded
  `230` for the width guess, never checked the bottom or left. Fixed by
  measuring the popover's real `offsetWidth`/`offsetHeight` (hidden via
  `visibility`, not `display`, so nothing flashes at the wrong spot first),
  then: prefer right-of-click, flip left if that overflows; prefer
  top-aligned-with-click, flip to open upward (bottom-aligned) if that
  overflows; clamp into the viewport as a last resort either way.
- **Team mode's `showTeamPopover()` had the identical bug**, unfixed until
  this session — same positioning logic copied over verbatim (deliberately
  duplicated, not shared, per this file's own "own second `<script>` block,
  never reads into the other's closure" rule for Team mode isolation). If
  this logic changes in one, change it in both.
- **Root cause of "the tab-bar bug is still happening" reports after it was
  already fixed 2026-07-18:** the installed `/Applications/Detail.app` was
  never updated — rebuilding the DMG in `dist/` does not touch the already-
  installed app. Confirmed via `mdls`/`ls -la` that the installed app was
  dated **July 16**, three days before the fix even existed. Going forward,
  after any rebuild meant to fix something the user will actually notice,
  **also reinstall it** (`hdiutil attach` the new DMG, `cp -R` the `.app`
  over `/Applications/Detail.app`, `hdiutil detach`) rather than just
  confirming the DMG file's timestamp — a fresh DMG sitting in `dist/`
  proves nothing about what's actually running.
- Filesystem-MCP was intermittently down this session (every call failed,
  including read-only ones like `list_allowed_directories`) while osascript
  stayed up. Worked around it entirely via `do shell script` + Python
  heredocs for file edits. **Gotcha hit along the way:** nesting a literal
  apostrophe inside a single-quoted Python heredoc that's itself inside a
  double-quoted AppleScript `do shell script` string mangles into a literal
  triple-quote artifact in the output file — caught by grepping for that
  pattern after every such edit before trusting it. This note itself was
  written via a safer route (base64-encoded transfer) after the same nested-
  quoting problem broke AppleScript's own parser outright on a large enough
  heredoc.

## Team Mode week-view fixes — 2026-07-18

Three changes to the week view (`#team-day-cols` / `.team-day-col-mini`) and
the expanded day panel, made same-day as the name-abbreviation addition
above. **This section was missing from this file until 2026-07-20** — the
07-19 cleanup audit below reviewed code/deps/dead-code but didn't catch that
these three were never written up here. Verified against the live file
before documenting, per the rule at the bottom of this doc.

1. **Bug fix: `#team-week-tabs` bottom bar was taking ~30% of the screen,
   tabs stacked vertically instead of horizontally.** Root cause:
   `#team-tabs-list` (the flex container for the `.tab` divs) never had a
   CSS rule at all — Single mode's equivalent, `#tabs-list`, has
   `display:flex;gap:5px;flex:1;overflow-x:auto;`, but Team mode's ID was
   never given the same rule. Without it, `#team-tabs-list` fell back to a
   plain block-level div, so its `.tab` children (also divs) stacked full-
   width instead of sitting in a horizontal scrolling row. Fixed by adding
   the missing `#team-tabs-list` rule, identical to Single mode's.
2. **Focused day panel widened.** `LANE_MIN_WIDTH` 190→260, `LANE_GROWTH`
   50→70 (both in the team-mode script's constants), `#team-day-panel`'s
   CSS fallback `width` 260px→340px and `max-width` `calc(100% - 40px)`→
   `calc(100% - 24px)` (a bit more screen real estate before the cap kicks
   in). Purely a sizing change — `computePanelWidth()`'s formula is
   untouched, just fed bigger constants.
3. **Drag-and-drop shift creation now works from the week view, not just
   the expanded day panel.** Each `.team-day-col-mini` got `dragover`/
   `dragleave`/`drop` handlers mirroring the existing per-lane drop handler
   in `renderDayLanes()` — same `lowestFreeLane()` auto-pick, same
   `state.defaultLengthMin`-capped-to-remaining-day duration, same
   max-10-people alert. Difference: slot is computed against the mini
   column's own `getBoundingClientRect().height` (÷24) instead of a fixed
   `TEAM_ROW_H`, since the mini column isn't full-scale. If that same day
   happens to be open in the focus panel when a week-view drop lands,
   `renderDayLanes()` also gets called so the panel doesn't show stale
   state. The idea: rough-place from the week view, then open the day to
   fine-tune exact time/lane — the week view was never meant to replace the
   day panel's precision, just remove the "must open the day first" step
   for the common case.

## Cleanup audit — 2026-07-19

A full sweep for bloat/dead code/stale deps/branding drift, at the developer's request.
Result: the app code itself was already lean — zero unused CSS classes, zero
unreferenced JS functions, zero duplicate element IDs, zero commented-out
code blocks, no leftover feature remnants (`packLanes`, workshop mode,
templates, etc. from the old lineage are genuinely gone, not just hidden).
What needed fixing was all in tooling/deps/disk, not `index.html`:

- **Electron was `^31.0.0`** — mid-2024, several majors past Electron's
  3-supported-version window (current stable is v43.x as of this writing),
  carrying known-outdated Chromium/Node. Bumped to `^43.0.0`, electron-builder
  `^24.13.3`→`^26.15.3`. Ran `npm install` (0 vulnerabilities reported),
  rebuilt, and did an actual smoke test — launched the built `.app` via
  osascript, confirmed the `Detail` process was alive after 3s, quit it
  cleanly. `webPreferences` (contextIsolation/sandbox/nodeIntegration) and
  every API `main.js` touches (`setWindowOpenHandler`, `Menu` roles,
  `setAboutPanelOptions`) are all long-stable across that version range, so
  this was a low-risk jump, but **the developer should still do a normal-use pass**
  (drag/resize, both modes, export) since a background-session smoke test
  can only confirm it launches, not that every interaction still feels right.
- **`package-lock.json` still said `"name": "hitachi-schedule"`,
  `"version": "1.0.0"`** — stale from before the Detail rebrand, never
  caught because nothing reads that field at runtime. Fixed itself on the
  `npm install` above (npm syncs it to `package.json` on install).
- **`dist/` had a stale `Detail-0.84.8-arm64.dmg` sitting next to `0.84.9`**
  (electron-builder doesn't clean old versioned output). Deleted the
  superseded one — general rule going forward: after a version bump build,
  remove the previous version's `.dmg`/`.blockmap` from `dist/` unless the developer
  says otherwise.
- **`archive/` (2 old `Hitachi Schedule`-branded `.dmg`s, ~190MB combined)
  was left alone** — it's explicitly named `archive/`, which reads as
  intentional, not accidental cruft, so this wasn't deleted without asking.
  Flagged to the developer; delete on his say-so, not a future session's assumption.
- No CSP meta tag in `index.html`. Real risk is low (the app makes zero
  network calls — vendored `html2canvas` is the only `<script src>`, and
  `webPreferences` already has contextIsolation/sandbox/nodeIntegration
  locked down) but a `<meta http-equiv="Content-Security-Policy">` restricting
  to `default-src 'self'` would be free defense-in-depth. Not added this
  session — flagged as a nice-to-have, not urgent enough to touch working
  markup unprompted.
- `alert()` is used for every validation/error message in both modes (7
  call sites) — functionally fine and consistent, but native blocking
  dialogs read as less polished than an inline toast/banner for a paid
  product. Not changed — it's a UX-polish call for the developer to make, not a bug,
  and touching all 7 call sites is a real diff for a "nice to have."

## Two divergent lineages exist in `~/Downloads` — don't assume feature parity

the developer has iterated on this app across multiple separate chat sessions, each
starting from a downloaded zip and editing independently. As of this file,
`~/Downloads` contains at least:

- `hitachi-schedule-app/`, `hitachi-schedule-app-fixed.zip`,
  `hitachi-schedule-app.zip` — an **older lineage** with: undo/redo (Ctrl+Z/Y),
  a weekly-hours-total badge per person, "always auto-join adjacent
  same-person shifts," template save/load, and a "workshop mode" sandbox
  toggle. Storage key uses `activeWeek`, not `currentWeekStart`.
- **The current, active lineage — now at `~/Desktop/Detail v0.84/`** (moved
  from `~/Downloads/Hitachi Schedule v0.83/`; renamed on the 0.83→0.84 minor
  bump). Has things the other doesn't: right-click context menu (copy / cut /
  paste-and-replace / change-guard submenu), a collapsible sidebar, dynamic
  `ROW_H` that auto-fits the window, inline month view (not a modal), JSON
  backup/restore to a file, and Team mode (multi-person overlapping shifts).
  It does **not** have undo/redo, hours totals, templates, or workshop mode.

These are not merged and should not be assumed compatible — different data
model field names, different render pipelines. If the developer asks for a feature
from "the other version," treat it as a fresh feature request against *this*
codebase, not a port. If you're unsure which folder is the one currently
being worked on, check file modification times (`get_file_info`) rather than
assuming — the developer renames/deletes these folders between sessions.

## Build / package

```bash
cd "Detail v0.84"    # path drifts between sessions — confirm with get_file_info
                     # before assuming; currently ~/Desktop/Detail v0.84/
npm install         # only needed once, or after deleting node_modules
npm run build:arm   # runs electron-builder --mac --arm64, unsigned, drops a
                     # drag-to-Applications .dmg in dist/
```

**Execution access (updated 2026-07-18):** In sessions where a Filesystem-MCP
connection AND an osascript/"Control your Mac" connection are both available,
AI collaborators (Claude) CAN run this build directly — no need to hand the
command back to the developer. Confirmed working via `do shell script "zsh -lc
\"cd '<path>' && npm run build:arm\""` (zsh as a login shell so nvm's PATH
from .zshrc/.zprofile actually loads — plain `do shell script "npm ..."`
won't find npm, since AppleScript's shell doesn't source profile files by
default). `node`/`npm` live under `~/.nvm/versions/node/v24.16.0/bin/` via
nvm, not a system path.

After running the build, always verify with `get_file_info` on the resulting
`.dmg` that its modified time is newer than the source files just changed —
don't just trust exit status. If osascript or Filesystem access isn't
present in a given session, fall back to giving the developer the exact command
instead of claiming to have built it.

If bumping the version for a new build, update both `package.json`'s
`"version"` and the `"dmg": { "title": ... }` so old and new installers don't
look identical in Finder.

## Rules for AI collaborators on this project

**Token efficiency**
- Never paste the whole file back to yourself "to be safe." Use
  `Filesystem:edit_file` (oldText/newText) for targeted changes. Only do a
  full-file rewrite when the diff genuinely touches most of the file.
- Read the specific section you're changing, not the whole 1450-line file,
  unless you're doing initial onboarding (like this doc).
- Don't re-derive things already documented here (the data model, the drag
  architecture) — read this file first, every session.

**Correctness discipline**
- **Always re-read the live file from disk before editing it.** Do not edit
  from memory of what you wrote in a previous conversation — a different
  session may have changed it since (see "two lineages" above; this file
  itself exists because that happened).
- After any JS edit, sanity-check syntax (extract the inline `<script>`
  block and run `node --check` on it, or equivalent) before telling the
  user it's done.
- Check for duplicate element IDs when adding new UI — this file uses plain
  `document.getElementById`, which silently returns the first match if
  there are duplicates.
- Don't touch `attachMove`/`attachResize` internals casually. If a bug
  report mentions dragging freezing, cards sticking, or text getting
  selected during a drag, that's the exact failure mode described above —
  look for a `renderDayCols()` (or any render call) that got moved earlier
  in the drag lifecycle than it should be, not a symptom that needs a new
  workaround layered on top.

**UX priorities, in order**
1. Never lose a user's data. Confirm before anything destructive (clear
   week, restore backup, remove a person which cascades their shifts).
2. Drag/resize must feel physically direct — smooth follow while held,
   snap only on release, never mid-gesture.
3. Visual state changes (a mode toggle, a pending action) must be obvious
   at a glance, not just a subtle color shift — the developer has explicitly asked
   for this before (e.g. workshop mode's banner + dashed border in the
   other lineage).
4. Keep the toolbar readable. It already wraps at narrow widths; don't add
   buttons without checking they don't crowd out `Export screenshot`, which
   is the single most-used action in the app.

**When in doubt:** ask what folder/version is currently canonical rather
than guessing from a previous conversation's context. This file's own
existence is the direct result of an AI once conflating context-window
memory with the actual state of the file on disk.

## Team Mode focus-panel widen / no-double-booking / clear-day — 2026-07-21 (late session)

Three more team-mode changes, made in the session right after the popover
fix above but never written up here until now — caught only because this
session diffed `index.html`'s mtime (21:24) against this file's own last-edit
stamp (21:00) per the "always re-read the live file" rule, found a gap, and
verified the code was already there rather than redoing the work.

1. **Focused day panel widens ~10% per simultaneous shift, compounding.**
   New constant `LANE_WIDEN_RATE = 1.10`. `computePanelWidth()` now does
   `LANE_MIN_WIDTH * Math.pow(LANE_WIDEN_RATE, lanes-1)` instead of the old
   flat `LANE_GROWTH` per-lane add-on — growth visibly accelerates on more
   crowded days rather than a constant rate all the way to `MAX_LANES`.
2. **A person can no longer be double-booked at overlapping times on the
   same day**, regardless of lane. New `personOverlap(day, personId, slot,
   durMin, excludeId)` — same interval-overlap test as `laneConflict()` but
   keyed on `personId` instead of `lane`. Wired into every point a shift's
   person/day/time can change: both drop handlers (week-view mini-column
   and in-panel lane), move commit, resize commit, and popover reassignment
   / length edits. Rejected the same way lane conflicts already were
   (snap back / alert), not a new UX pattern.
3. **"Clear day" added to the day panel header**, next to the ✕ close
   button (`#team-day-clear`). Confirms, then `pushUndo()`s, then removes
   only shifts where `day===openDayIndex` — leaves every other day in the
   week untouched. Mirrors `team-clear-week`'s confirm-then-pushUndo
   pattern exactly, just filtered to one day. Runs
   `compactAllLanesInWeek()` afterward same as clear-week does, so an
   emptied day doesn't leave permanently-skipped lane numbers behind.

Rebuilt (`npm run build:arm`) and reinstalled to `/Applications/Detail.app`
this session — the previous DMG (20:56) predated the `index.html` edit
(21:24) that added these three, so the installed app was running without
them until this rebuild. Verified via both scripts' `node --check` and the
installed app's `mdls` timestamp being newer than the source edit.

## Windows target added (config only, unbuilt) — 2026-07-21

the developer wants to scale this into a real product and has a Windows 11 box to
test on. Audited `main.js`/`preload.js` first — turns out almost nothing
here was actually Mac-specific to begin with:
- `buildMenu()` already branches on `process.platform === 'darwin'` for the
  app-name menu (mac-only convention); Edit/View/Window menus are shared.
- `legacyUserDataDir()` already has a `win32` branch (`%AppData%\Hitachi
  Schedule`) alongside darwin and the generic fallback.
- `window-all-closed` already checks `process.platform !== 'darwin'` before
  quitting (Windows/Linux convention, correctly excludes mac's dock-icon
  behavior).
- All file paths go through `path.join`/`app.getPath`, nothing hardcoded
  with `/`-style separators.
- The one Undo shortcut (`Cmd/Ctrl+Z`) already checks `e.metaKey ||
  e.ctrlKey`, so it works unmodified on Windows.
- `preload.js` is plain contextBridge/ipcRenderer, zero OS-specific code.

So this was a **packaging gap, not a code gap** — matches what this file's
"still open" list already flagged ("needs a Windows/Intel target + CI, not
just a config change" — that line was slightly pessimistic; turned out to
be *mostly* just a config change).

**What was added**, `package.json` only:
- `build.win.target`: `nsis` (installer, x64) + `portable` (single .exe,
  x64) — both, so the developer can test the quick portable exe first and use nsis
  once he wants a real install/uninstall experience.
- `build.win.icon`: pointed at the existing `build/icon-source.png`
  (1024×1024 — already the right size electron-builder wants for its
  built-in icon generation, which auto-produces the multi-res `.ico` it
  needs; no separate `.ico` file was created, none should be needed).
- `build.nsis` block: not one-click (shows the installer UI), lets the user
  pick install dir, creates desktop + start menu shortcuts — standard
  expectations for a Windows installer, none of that was implied by
  defaults.
- New script: `"build:win": "electron-builder --win --x64"`.

**Not done this session, on purpose:** did not attempt to cross-build the
Windows target from this Mac. electron-builder *can* cross-build NSIS
installers from macOS, but it shells out to `wine` for it and that's a
fragile, slow dependency to debug blind with no Windows box in this
session to verify the actual output against. the developer has a real Windows 11
machine — building natively there is strictly more reliable and was the
plan he stated anyway. Also **completely unverified**: this app has never
actually been run on Windows. The audit above is code-reading confidence,
not a tested one — the developer should do a real pass (drag/resize both modes,
export screenshot, backup/restore, both single and team mode persistence
paths) after the first Windows build, same as any new-platform bring-up.

**To build on the Windows 11 box:**
```
git clone <repo>            (or copy the "Detail v0.84" folder over)
cd "Detail v0.84"
npm install                 # will fetch/rebuild native deps for win32/x64
npm run build:win           # drops installer + portable .exe in dist\
```
Node/npm need to be installed on that machine first (nvm-windows or the
official installer, doesn't matter which). No code signing cert configured
— like the mac build, this ships unsigned, so Windows SmartScreen will
show an "unknown publisher" warning on first run until/unless the developer buys a
code-signing cert. Same "still open" item as the mac notarization gap
below, same root cause (no cert), not fixed here.

## First Windows build — completed, unverified on actual Windows — 2026-07-21

Built on this Mac (no Wine involved — electron-builder ships its own
cross-platform NSIS binaries, and the `win.icon`/`.ico` generation is pure
JS too, so nothing here needed Wine at all, contrary to this file's earlier
"strictly more reliable to build on the real Windows box" caution — that
caution about *verifying the output* still stands, just not about the
build mechanics).

**Output**, both in `dist/`:
- `Detail Setup 0.84.9.exe` — NSIS installer, ~99.6MB
- `Detail 0.84.9.exe` — portable, ~99.4MB

**Gotcha hit and worked around:** the first build attempt produced a
`Detail Setup 0.84.9.exe` that was only ~206KB — broken, missing its
payload. electron-builder logged `skipped archiving reason=Archive file is
up to date outFile=.../detail-0.84.9-x64.nsis.7z` for a `.7z` that didn't
actually exist in `dist/`. Root cause suspected: an earlier build invocation
in the same session didn't report back cleanly (an AppleScript/osascript
wrapping issue, not an electron-builder issue) and may have raced a second
invocation against the same output path, leaving a stale cache entry that
made the second run trust a nonexistent archive as "already built." Fixed
by killing any stray `electron-builder` processes, deleting `dist/`
entirely (kept the unrelated mac `.dmg`), and rebuilding once, clean, in
the background with output redirected to a log file rather than piped
through the AppleScript call directly (piping through `do shell script`
truncated/lost output on a long-running command — background + log file +
poll was the reliable pattern). **If a future Windows build ever looks
suspiciously small, don't trust it — `rm -rf dist/win-unpacked` and every
Windows-target file, then rebuild clean, before assuming it's fine.**

**Verified before calling it done:**
- `file` on both `.exe`s: legitimate PE32 NSIS self-extracting archives,
  distinct MD5s (not a corrupted duplicate of the broken first attempt).
- `dist/win-unpacked/Detail.exe`: genuine PE32+ x86-64 Windows binary.
- `dist/win-unpacked/resources/app.asar` present (the actual app code).

**Not verified, and can't be from this Mac:** whether it actually launches
and runs correctly on Windows. Zero runtime testing happened — no Windows
box in this session. the developer is testing on his Windows 11 machine tomorrow.
Expect the same SmartScreen "unknown publisher" warning noted when the
win target was first added (still unsigned, no cert). If something's
broken, it's almost certainly either a first-real-runtime issue (nothing
platform-specific was found on code read, but "read the code" and "ran it"
are different confidence levels) or a data-path issue worth checking first:
`%AppData%\Detail\hitachi-schedule-data.json` /
`%AppData%\Detail\detail-team-data.json` — confirm `app.getPath('userData')`
resolves somewhere sane on first launch before chasing anything more exotic.

## Single-mode popover: always requires a fresh click to open — 2026-07-22

Changed the click-to-switch-popover behavior the developer didn't like: previously,
clicking a *different* shift while a popover was already open closed the
old one and opened the new one's popover in that same click — felt like
the popover was "following the cursor" rather than requiring a deliberate
open action.

Now: with a popover open, the **first** click anywhere outside it — empty
grid space, the shift the popover belongs to, or a completely different
shift — always just closes it. Nothing opens in that same click. Opening a
different shift's popover now always takes a second, separate click.

Change is entirely inside the per-shift `click` listener in `index.html`
(single mode only — this section doesn't exist in Team mode, which never
had the "switch directly" behavior to begin with, per its own
`showTeamPopover`/`hideTeamPopover` click handling). Was:
```js
if(activeShift===shift){ hidePopover(); return; }
showPopover(shift, el);
```
Now:
```js
if(activeShift){ hidePopover(); return; }
showPopover(shift, el);
```
The only change is dropping the `===shift` check — any open popover blocks
opening a new one on this click, not just the one belonging to the shift
being clicked. The existing document-level delegated click handler (the
one that closes the popover on clicks in truly empty space) didn't need
any change — it already left shift-click behavior entirely to each shift's
own listener.

## Beta-prep: git history scrubbed — 2026-07-22 (following session)

The security audit above cleaned live file content but not history — every
prior commit still carried the developer's real name, real employer, and
personal email (as commit author) in old diffs. Since the repo had briefly
been public, that was a real, already-realized exposure, and it would have
repeated on every future push.

Fixed by squashing the entire history into a single clean commit (orphan
branch → `git add -A` → one commit → replaced `main` → `git push --force`).
Verified post-squash: `git log --oneline origin/main` shows exactly one
commit, and a full `git grep` across it for the developer's name / real
employer / personal email comes back clean. Old commit objects expired
locally (`git reflog expire` + `git gc --prune=now`) so they're not sitting
recoverable on disk either.

Commit author identity going forward is the project's business contact
(`campaignerstudios@gmail.com`, name "Campaigner Studios"), set via local
`git config user.name`/`user.email` in this repo — not global, doesn't
affect other repos.

**Rule for future sessions:** don't assume `git log` is safe just because
current files are clean — check history too before any public push, since a
scrub of live content never touches prior commits.

## Security audit + fixes, GitHub repo made private, README rewritten for end users — 2026-07-22 (late session)

External AI-assisted security/compatibility pass, at the developer's request, focused
on Mac-only sharing readiness. `npm audit`: 0 vulnerabilities across 284
packages. No secrets, no data files, `node_modules`/`dist`/`archive`
correctly gitignored — nothing sensitive was ever pushed.

**Critical finding, fixed by the developer directly:** the GitHub repo
(`lapseR8/detail`) was actually **public**, not private as this file and
the Obsidian wiki note both claimed — confirmed via the GitHub API
(`private: false`, `visibility: public`), not just trusted from memory.
Since `CLAUDE.md`/`README.md` named the developer's real employer at the time
and described internal security-team scheduling software, this meant that
info was live on the open internet. the developer flipped it to private via the
GitHub UI. **Lesson: verify repo visibility against the API, don't trust a
prior session's note** — this file's own history is proof notes go stale.

**Three medium-severity code fixes**, all applied as targeted edits (not
full-file rewrites), `node --check`-verified, rebuilt, and reinstalled:
1. `main.js`'s `setWindowOpenHandler` called `shell.openExternal(url)`
   unconditionally on any URL the renderer tried to open. Now gated to
   `/^https?:\/\//i` — a `file://` or custom-scheme URL is denied instead
   of shelled out to the OS. No known exploit path today (nothing in the
   app renders untrusted links), but it was a standing footgun.
2. `schedule:save`/`teamSchedule:save` IPC handlers wrote whatever the
   renderer sent straight to disk with no shape check — the existing
   `isValidScheduleBackup()` only guarded the *import* flow, not the save
   path. Added `isPlausibleScheduleData()` in `main.js` (checks
   `people`/`weeks`/`shifts` are the right container types) as a
   defense-in-depth check at the actual IPC trust boundary. Not exploitable
   today given `contextIsolation`+`sandbox` are on and nothing untrusted
   loads in the renderer, but cheap insurance if that ever changes.
3. Added a CSP `<meta>` tag to `index.html`'s `<head>`
   (`default-src 'self'; connect-src 'none'; object-src 'none'; ...`) —
   previously flagged as a nice-to-have in the 2026-07-19 audit, now done.
   Matches the app's actual behavior (fully offline, one vendored script).

Rebuilt (`npm run build:arm` → `Detail-0.84.9-arm64.dmg`, ~119MB, sane
size), reinstalled to `/Applications/Detail.app` (`xattr -cr`'d since it's
still unsigned), launched, confirmed the process stayed alive, quit clean.
Committed and pushed (`725a9f1`) — rebased cleanly on top of an unrelated
README tweak (ALPHA label) the developer had made directly on GitHub in between
sessions, no conflicts.

**Other findings, not code bugs — flagged, not all fixed:**
- Ad-hoc-signed + unnotarized + arm64-only build: anyone the developer shares the
  DMG with will likely hit a harder failure mode than the usual Gatekeeper
  warning — an ad-hoc-signed, quarantined app on Apple Silicon often shows
  "app is damaged" rather than "unidentified developer." The `xattr -cr`
  workaround now lives in the rewritten `README.md`'s Install section.
  Intel Macs can't run this build at all (arm64-only target) — a universal
  build is the fix if that audience matters, not done this session.

**README.md fully rewritten** — it was pure internal build documentation
(project layout, build commands, icon regen scripts) with nothing for
someone who just wants to install and use the app. Restructured
user-first: what the app does → install steps (incl. the Gatekeeper/
`xattr` workaround) → how to use both modes → data/privacy → known
limitations, with the old build/project-layout content moved to a short
"For developers" section at the bottom that just points to this file
rather than duplicating it. Nothing here in `CLAUDE.md` changed structurally
— this file stays the AI/dev source of truth, README is now the human-
facing front door.
