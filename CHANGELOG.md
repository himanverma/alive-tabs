# Changelog — Alive TABs

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

---

## [0.3.3] — 2026-10-15

Docs release — no extension-code changes.

- README: prominent **Buy Me a Coffee** button (top + support section),
  feature list updated with auto-flag rules, custom presets, and
  session-tab restart persistence.
- `WebieAPP` is now a **verified** Open VSX namespace — the
  unverified-publisher banner is gone from all versions.
- `IMPLEMENTATION_PLAN.md` §F documents the publishing-hold incident and
  its resolution.

---

## [0.3.2] — 2026-10-15

Republish — identical code to 0.3.0. **Live on Open VSX** (`WebieAPP`
namespace, canonical listing) and GitHub Releases.

Release-process notes (details in `IMPLEMENTATION_PLAN.md` §F):

- Open VSX briefly held all new versions inactive — Eclipse publisher
  agreement requirement; resolved once signed.
- `0.3.1` is a permanently burned version number (unpublished; Open VSX
  versions are immutable) — never `ovsx unpublish` to retry.
- A temporary parallel `himanverma.alivetabs` listing was used to diagnose
  the hold and has been removed; `WebieAPP.alivetabs` is canonical.

---

## [0.3.0] — 2026-10-14

Feature release — auto-flag rules, user-defined presets, deep-mode flags, and
a unit-test suite. See `IMPLEMENTATION_PLAN.md` for the design.

### Added — `alivetabs.rules`

Auto-apply a flag and/or color to file tabs matching glob patterns — no
marking required:

```json
"alivetabs.rules": [
  { "pattern": "**/*.test.*", "flag": "🧪" },
  { "pattern": "**/migrations/**", "color": "#7c3aed" },
  { "pattern": "README.md", "flag": "📌", "color": "#db2777" }
]
```

- Patterns containing `/` match the workspace-relative path (folder name
  included in multi-root workspaces); patterns without `/` match the file
  basename. First matching rule wins.
- Glob engine supports `**/` (any depth), `*`, `?`, `{a,b}` alternation, and
  `[...]` classes — implemented in `src/pure.ts`, zero new dependencies.
- Produces **virtual marks** — never persisted; stored marks always take
  precedence, and clearing a stored mark exposes the rule again.
- The overview panel lists rule-matched open files as dimmed `auto` rows
  (with Flag/Color buttons to convert them into stored marks).
- Deep mode honors rules too — they're shipped in the config snapshot and
  evaluated in the injected runtime.

### Added — `alivetabs.presets`

User-defined presets merged into the *Set Flag & Color Preset* picker:

```json
"alivetabs.presets": [
  { "name": "Design", "flag": "🎨", "color": "#0ea5e9" }
]
```

### Added — deep-mode flag rendering

The injected workbench runtime now renders flag text on tabs (prefix/suffix
per `alivetabs.flagPosition`) in addition to colors — closing the gap for
tabs whose decorations aren't queried.

### Infrastructure

- New `src/pure.ts` — dependency-free helpers (`contrastColor`,
  `sanitizeHex`, `escapeCssContent`, `firstGraphemes`, `globToRegExp`/
  `globMatch`) with no `vscode` imports.
- New `tests/pure.test.js` — 10 `node:test` unit tests against compiled
  output; run with `npm test`. Zero new devDependencies.
- Fixed the user's `publish:ovsx` script to use `@vscode/vsce` (the `vsce`
  package name is deprecated).

### Notes

- JSDoc gotcha hit during development: `{a,b}` / `[...]` inside `/** */`
  comments are parsed by TypeScript as JSDoc type expressions and produce
  real `TS1005` errors — keep those tokens out of doc comments.
- VS Code Marketplace publishing stays manual (owner uploads each release).

---

## [0.2.3] — 2026-10-14

Docs & release-process release — no extension-code changes.

### Documentation

- `PUBLISHING.md` → new **Step 3.4 — Verify the `WebieAPP` Namespace**:
  explains the Open VSX *"not a verified publisher of the namespace"* banner
  (unclaimed namespaces are public by default), and the one-time fix — a
  `claim-namespace-ownership` issue on `EclipseFdn/open-vsx.org` filed by the
  repo owner's GitHub account. The extension qualifies for **Option 1** (same
  publisher ID on the VS Code Marketplace with a repo URL in `package.json`),
  which is the fastest validation path. Approval removes the warning from all
  versions — no republish needed.
- README/PUBLISHING version references bumped to `0.2.3`.

### Release notes

- The `WebieAPP` namespace claim on Open VSX was **approved 2026-10-15** —
  the unverified-publisher banner is gone from all versions. The VS Code
  Marketplace listing is unaffected.

---

## [0.2.2] — 2026-10-14

### Fixed — session/agent tabs losing flags after restart

- **Root cause**: `webview-panel:` / `vscode-cascade-editor:` marks are keyed by
  exact URI, and those URIs embed session ids that change every time a panel is
  re-created (IDE restart, close + reopen, extension reload). The persisted
  marks survived (visible in the overview) but the new tab URIs never matched —
  and with several same-`viewType` tabs open, single-candidate re-attach was
  correctly refusing to guess.
- **Fix**: a reconciliation pass now pairs decoration-queried URIs with open
  tabs **positionally within each viewType bucket** (queries arrive in
  tab-strip order), then migrates each stale mark to the tab carrying its
  **exact stored label**. Pairing only runs when open-tab count equals queried
  URI count and all labels in the bucket are unique — anything ambiguous stays
  orphaned in the overview rather than flagging the wrong tab.
- The seen-URI cache now keeps first-seen order on re-query (required for the
  positional pairing), and reconcile runs on tab changes, close-evictions, and
  shortly after activation so flags reattach automatically on restart.

### Known limitations

- Positional pairing assumes decoration queries arrive in tab-strip order;
  if the workbench ever queries out of order within a same-viewType bucket,
  marks could attach to the wrong same-type tab (recoverable via re-mark).
- Buckets with duplicate labels or mismatched tab/URI counts are skipped by
  design — re-mark via context menu or the overview panel.

---

## [0.2.1] — 2026-10-14

Bug-fix release focused on flag duplication, marks lost on tab close/re-open,
and workspace-settings safety.

### Fixed — flag rendering

- **Double flag on the tab label** when `alivetabs.useCustomLabels` is `true`:
  `customLabels.patterns` already rewrote the label text (e.g. `file.ts 🔴`) and
  the decoration provider appended the flag again via CSS. When custom labels
  cover a workspace file, the decoration now delegates flag rendering entirely —
  no badge, no injected `::after` — eliminating `file.ts 🔴 🔴` in both suffix
  and prefix modes (and the doubled badge in the Explorer).
- **Flags not reappearing after tab/browser events**: decorations are now
  re-emitted on every tab open/close/change (`tabGroups.onDidChangeTabs`), so
  marks re-render even when another decoration provider temporarily wins the
  merged decoration color for a resource.

### Fixed — state & lifecycle

- **Marks lost when a webview/agent tab is closed and reopened**: panel URIs
  (`webview-panel:`, `vscode-cascade-editor:`) embed session IDs that change on
  reopen. Marks now carry `viewType`/`label` identity and are automatically
  re-attached when exactly one stale candidate matches and the old URI is no
  longer rendered — tracked via close-event eviction of the seen-URI cache.
- **Wrong tab marked with multiple same-type panels**: `resolveActiveTab` now
  picks the *most recently rendered* matching URI instead of the last inserted.
- **`seenNonFileUris` unbounded growth / stale fallback**: the cache is capped
  at 128 entries and the `lastNonFileUri` fallback is restricted to known
  editor-tab schemes.
- **Saving an untitled editor lost its mark**: marks migrate `untitled:` →
  `file:` on the tab `changed` event; marks on discarded (closed) untitled
  editors are pruned.
- **Marks for deleted files never cleaned**: on activation, `file:` marks whose
  target no longer exists on disk are pruned (`pruneMissingFiles`).
- **Slow activation**: commands now register before `labels.sync()` /
  `server.start()` run in the background.

### Fixed — workspace settings safety

- **`colorActiveTab` wiped user-owned `tab.active*` keys**: `ActiveTabColorizer`
  now tracks exactly which keys it wrote (`managedColorCustomizations` stores a
  key list, not a boolean) and removes only those. The one-time legacy v0.1.x
  cleanup is preserved.
- **`LabelSync` deleted hand-written `customLabels` patterns** matching the
  legacy `${filename} <flag>` shape on every sync — legacy cleanup now runs once
  per workspace, then never again.
- **`customLabels` multi-root collisions**: patterns include the workspace
  folder name in multi-root workspaces, glob metacharacters in file paths are
  escaped, and files outside all workspace folders are skipped (flag still
  renders via the decoration path).

### Fixed — deep mode (optional patch path)

- **Second IDE window showed the first window's marks**: the runtime now probes
  every config-server port and picks the response whose workspace `roots` cover
  the currently open tab paths.
- **Uninstall could roll back an IDE update**: `unpatch` now removes only the
  `<script src="./alivetabs.js">` tag from the current `workbench.html` and
  refreshes that single `product.json` checksum instead of restoring stale
  `.alivetabs.bak` files.
- **Loose tab matching cross-colored same-name files**: `matchTab` uses exact /
  path-boundary matches only, and basename/aria fallbacks apply only when a
  single candidate matches.
- **Config server couldn't recover after port exhaustion**: failure now resets
  internal state so a later `start()` can retry.

### Fixed — overview panel & commands

- Clicking a marked non-file tab in the overview no longer fails silently — it
  explains that the tab must be reopened manually.
- Overview webview gained a strict CSP + script nonce and
  `retainContextWhenHidden`.

### Fixed — CI/CD

- `publish.yml`: publish steps used step-level `env:` in their `if:` condition,
  which GitHub evaluates before the step env applies — the marketplace publish
  steps could never run. Secrets are now mapped at job level, and the GitHub
  Release is created *before* marketplace publishing so a publish failure can't
  block the VSIX asset.

### Known limitations

- **Decoration merge priority**: when another extension's
  `FileDecorationProvider` (e.g. Git status colors) wins the merged decoration
  for a resource, Alive TABs' injected CSS can't reach that element — the mark
  is invisible until the next refresh. There is no VS Code API for decoration
  priority; mitigated via re-registration + refresh-on-tab-change.
- **Ambiguous re-attach**: with two or more same-`viewType` panels closed and
  reopened, mark migration is skipped rather than risking a wrong attach;
  re-mark via the context menu or overview.
- **Explorer badge is capped at 2 graphemes** (VS Code limit): a custom flag
  like `WIP` shows `WI` in the Explorer; the tab label shows the full flag.
- **`useCustomLabels` puts the flag in the editor label**, which also feeds
  `window.title`'s `${activeEditorShort}` — the flag appears in the OS title
  bar. Inherent to that opt-in setting.
- **Deep mode renders colors only** — flag text requires the decoration path.

---

## [0.2.0] — 2026-10-14

### Changed

- Publisher ID changed to **`WebieAPP`** to match the registered Open VSX /
  VS Code Marketplace publisher (`himanverma` → `WebieAPP`; GitHub repository
  URLs unchanged).

### Added

- `PUBLISHING.md` — full guide for Open VSX, VS Code Marketplace, and GitHub
  Releases, plus a GitHub Actions publish workflow.
- `runtime/alivetabs.js` — optional deep-mode runtime polling a localhost
  config server (`alivetabs.enableDeepMode` / `alivetabs.disableDeepMode`).

### Features (current build)

- Per-tab colors on file, webview (`webview-panel:`), and Cascade agent
  (`vscode-cascade-editor:`) tabs via `FileDecorationProvider` + injected CSS.
- Three tab styles: `tinted`, `full`, `border` (`alivetabs.tabStyle`).
- Colored flags / custom tags on tabs and Explorer badge
  (`alivetabs.flagPosition`: `suffix`/`prefix`).
- One-click flag+color presets, interactive overview panel, status bar
  indicator, rename/delete-aware mark migration.
- Optional `.vscode/settings.json` sync (`alivetabs.useCustomLabels`,
  `alivetabs.colorActiveTab`) — both default `false`.
