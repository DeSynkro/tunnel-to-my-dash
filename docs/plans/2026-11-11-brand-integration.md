# Brand Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the provided house-and-tunnel logo into the app and shift the interface from cool ink + mint to the logo's warm ink + amber palette.

**Architecture:** The SVGs in `logo/` stay the source of truth. A 512px PNG and an in-app mark are derived from them and committed, so runtime builds need no SVG rasteriser. The palette lives in the three renderer stylesheets plus two window background colors in the main process; no layout or component structure changes.

**Tech Stack:** Electron 45, TypeScript, plain CSS, esbuild, electron-builder, rsvg-convert for the one-time icon render.

**Spec:** `docs/DESIGN.md` (Brand and interface palette)

## Global Constraints

- Linux first; no new runtime dependencies and no network calls at runtime.
- `logo/` is the source of truth; derived assets are committed.
- No light theme, no typography change, no tray or launch-at-login work.
- Keep the repo human-looking: no new "superpowers" or AI-style folder names.
- Commits use `DeSynkro` as the author, small steps, one concern each.
- Existing behavior, layout, spacing and tests must not change.
- Amber is a highlight only: focus, links, active dots. Never a large fill.

## Review Focus

- **Small-mark legibility:** the house-and-tunnel detail must still read at 22-28px; verify in a 1:1 screenshot, not by zooming the SVG.
- **Body-text contrast:** secondary and muted text on the new surfaces must stay at least 4.5:1; verify with a ratio script.
- **Toolbar legibility over bright dashboards:** the near-opaque surface must still isolate the controls over a white page; verify with a bright dashboard screenshot in both toolbar modes.
- **Focus visibility:** the amber ring must be visible on both dark surfaces and the cream primary button.
- **Packaged icon:** the AppImage must actually carry the new `.desktop` icon, not fall back to Electron's default; verify by extracting the AppImage.

---

### Task 1: Add brand sources and derived assets

**Files:**
- Create: `desktop/src/renderer/brand-mark.svg`
- Modify: `desktop/build/icon.png` (replace placeholder), `desktop/build/icon.svg` (replace placeholder)
- Add: `logo/` (all SVGs and `PREVIEW.png`)
- Modify: `desktop/scripts/build.mjs`
- Commit: `docs/DESIGN.md`, this plan

**Interfaces:**
- Produces: `dist/icon.png` (512×512 window/package icon), `dist/renderer/brand-mark.svg` (mark for both HTML screens), `logo/banner.svg` (README).

- [ ] **Step 1: Render and copy the assets**

```bash
rsvg-convert -w 512 -h 512 logo/icon.svg -o desktop/build/icon.png
cp logo/icon.svg desktop/build/icon.svg
cp logo/icon-small.svg desktop/src/renderer/brand-mark.svg
identify desktop/build/icon.png   # expect: PNG 512x512
```

- [ ] **Step 2: Copy the new assets into the build output**

In `desktop/scripts/build.mjs`, next to the other `copyFile` calls:

```js
await copyFile(
  path.join(root, "src/renderer/brand-mark.svg"),
  path.join(dist, "renderer/brand-mark.svg"),
);
await copyFile(path.join(root, "build/icon.png"), path.join(dist, "icon.png"));
```

- [ ] **Step 3: Verify the build carries them**

Run: `make desktop-check`
Then: `file desktop/dist/icon.png desktop/dist/renderer/brand-mark.svg`
Expected: PNG 512×512 and SVG, both present.

- [ ] **Step 4: Commit**

```bash
git add logo desktop/build/icon.png desktop/build/icon.svg \
  desktop/src/renderer/brand-mark.svg desktop/scripts/build.mjs \
  docs/DESIGN.md docs/plans/2026-11-11-brand-integration.md
git commit -m "Bring in the brand assets"
```

---

### Task 2: Put the mark in the app chrome

**Files:**
- Modify: `desktop/src/renderer/index.html`, `desktop/src/renderer/lock.html`
- Modify: `desktop/src/renderer/styles.css`, `desktop/src/renderer/lock.css`
- Modify: `desktop/src/main/main.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `dist/renderer/brand-mark.svg`, `dist/icon.png` from Task 1.
- Produces: window icon on both windows; mark visible at 28px (main) and 22px (lock).

- [ ] **Step 1: Replace the inline route SVGs with the mark**

In `index.html` and `lock.html`, replace the inline `<svg class="brand-mark" …>` block with:

```html
<img class="brand-mark" src="./brand-mark.svg" alt="" aria-hidden="true" />
```

- [ ] **Step 2: Size the marks**

In `styles.css`, change `.brand-mark` to:

```css
.brand-mark {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}
```

In `lock.css`, change `.lock-brand .brand-mark` to width/height `22px` and drop its `color` line.

- [ ] **Step 3: Give both windows the icon**

In `main.ts`, add `icon: path.join(__dirname, "icon.png"),` to the `BrowserWindow` in `createWindow()` and the `BaseWindow` in the dashboard window setup.

- [ ] **Step 4: Add the README banner**

At the top of `README.md`, before the `# Tunnel to My Dash` heading:

```html
<p align="center">
  <img src="logo/banner.svg" alt="Tunnel to My Dash — a cream house with a tunnel arch" width="960">
</p>
```

- [ ] **Step 5: Verify the mark reads at real size**

Run `make desktop-check`, seed the test data as in the previous smokes, then screenshot the main menu and the lock overlay at 1024×768. Expected: the house and tunnel arches are legible at 28px and 22px; the mark is not a muddy square.

- [ ] **Step 6: Commit**

```bash
git add README.md desktop/src/main/main.ts desktop/src/renderer/index.html \
  desktop/src/renderer/lock.html desktop/src/renderer/styles.css desktop/src/renderer/lock.css
git commit -m "Use the house mark in the app chrome"
```

---

### Task 3: Warm the palette

**Files:**
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/renderer/toolbar.css`
- Modify: `desktop/src/renderer/lock.css`
- Modify: `desktop/src/main/main.ts` (two `backgroundColor` values)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: one palette shared by the main screen, dashboard toolbar and lock overlay.

- [ ] **Step 1: Apply the core tokens**

In `styles.css` `:root`:

| Token | Value |
| --- | --- |
| `--bg` | `#0a1011` |
| `--surface` | `#0f1618` |
| `--surface-raised` | `#151d1f` |
| `--border` | `rgba(240, 229, 212, 0.09)` |
| `--border-strong` | `rgba(240, 229, 212, 0.16)` |
| `--text` | `#ece7dd` |
| `--secondary` | `#a9a49a` |
| `--muted` | `#847f76` |
| `--faint` | `#7b756c` |
| `--accent` | `#f0a35a` |
| `--accent-soft` | `rgba(240, 163, 90, 0.14)` |

Change the primary button hover from `#f4f6f8` to `#f7f1e3`. Leave `--danger` and `--danger-border` as they are.

- [ ] **Step 2: Match the toolbar**

In `toolbar.css`:

- `--bg: #0a1011`, `--text: #ece7dd`, `--muted: #a9a49a`, `--faint: #7b756c`
- `--border: rgba(240, 229, 212, 0.1)`
- glass background: `rgba(10, 16, 17, 0.94)`
- peek fill: `rgba(236, 231, 221, 0.34)`
- button hover: `rgba(236, 231, 221, 0.08)`
- focus outline: `#f0a35a`

- [ ] **Step 3: Match the lock scrim and window flash color**

In `lock.css`, change the three `rgba(11, 13, 18, …)` scrim stops to `rgba(10, 16, 17, …)`.
In `main.ts`, change both `backgroundColor: "#0e1012"` values to `"#0a1011"`.

- [ ] **Step 4: Verify contrast**

Run a small WCAG script against the final values. Expected minimums:

```
text on bg            15.56
text on surface       14.84
secondary on surface   7.37
muted on surface       4.60
faint on bg            4.20
amber on bg            9.22
primary text on cream 14.72
```

No body or secondary text may fall below 4.5.

- [ ] **Step 5: Verify the look**

Run `make desktop-check`, then capture at 1024×768: main menu, settings, dashboard with auto-hide on (peek and expanded), dashboard with auto-hide off, and the lock overlay over a bright page. Expected: warm cast is subtle, amber appears only as accents, toolbar controls stay legible over white content, primary buttons are cream.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/styles.css desktop/src/renderer/toolbar.css \
  desktop/src/renderer/lock.css desktop/src/main/main.ts
git commit -m "Warm the interface toward the logo palette"
```

---

### Task 4: Package, verify and document

**Files:**
- Modify: `docs/BACKLOG.md`
- Artifact: `desktop/release/Tunnel-to-My-Dash-0.1.0-x86_64.AppImage`, `desktop/release/SHA256SUMS`

**Interfaces:**
- Consumes: all earlier tasks.

- [ ] **Step 1: Build the AppImage and checksums**

Run: `make appimage && make checksums`
Expected: exit 0; `SHA256SUMS` lists the new AppImage.

- [ ] **Step 2: Verify the embedded icon**

```bash
cd .tmp && ../desktop/release/Tunnel-to-My-Dash-0.1.0-x86_64.AppImage --appimage-extract >/dev/null
file squashfs-root/.DirIcon
```

Expected: the extracted icon is a PNG matching the new house mark. Open it and confirm it is not Electron's default icon.

- [ ] **Step 3: Run the packaged smoke suite**

On seeded data, run `TTMD_SMOKE` modes: `full`, `settings`, `toolbar` (with pointer moved to the peek pill), `toolbarfixed`, `refocus`, `lock`, `lockback`.
Expected: all exit 0 with their existing `[smoke]` success lines.

- [ ] **Step 4: Capture the packaged look**

Screenshot the packaged main menu, dashboard in both toolbar modes and the lock overlay. Expected: same palette and marks as the dev build.

- [ ] **Step 5: Update the backlog**

Move the "Design distribution artwork around the in-app route mark" item out of Interface and add a Done bullet describing the brand integration: marks in the masthead and lock screen, window/AppImage icon, README banner, warm ink + amber palette.

- [ ] **Step 6: Clean up and confirm**

Run `make check` and `make desktop-check`. Remove `.tmp` test data, logs and screenshots; confirm no app processes and no `$HOME/.config` leftovers. Record the AppImage hash.

- [ ] **Step 7: Commit**

```bash
git add docs/BACKLOG.md
git commit -m "Finish the brand integration"
```
