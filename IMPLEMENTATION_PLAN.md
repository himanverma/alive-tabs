# Alive TABs — Implementation Plan (v0.3.0)

Status: in progress. Scope = the approved roadmap items; VS Code Marketplace
publishing stays **manual** (owner handles it each release).

## Scope

| # | Item | Type |
|---|------|------|
| A | `alivetabs.rules` — auto-apply flag/color by glob pattern | feature |
| B | `alivetabs.presets` — user-defined flag+color presets | feature |
| C | Deep mode renders flag text (currently colors only) | feature |
| D | Extract pure helpers → `src/pure.ts` + `node:test` suite | infra |
| E | CI publishing — dropped (manual releases) | process |
| F | Open VSX namespace claim — **blocked on user** | process |

---

## A. `alivetabs.rules` — auto-flag rules

**Schema** (`package.json` `contributes.configuration`):

```json
"alivetabs.rules": {
  "type": "array",
  "default": [],
  "items": { "type": "object", "required": ["pattern"],
             "properties": { "pattern": {"type":"string"},
                             "flag":   {"type":"string"},
                             "color":  {"type":"string"} } },
  "description": "Auto-apply a flag/color to file tabs matching a glob. First match wins; stored marks take precedence."
}
```

**Semantics**
- `file:` URIs only. Patterns containing `/` match the workspace-relative POSIX
  path (`folder/x.ts` name included in multi-root); patterns without `/` match
  the basename. First matching rule wins.
- Produces a **virtual mark** — computed in `provideFileDecoration`, never
  persisted to `workspaceState`, never listed as a stored row.
- Precedence: stored mark > rule > nothing. Clearing a stored mark exposes the
  rule again (rules are ambient defaults, not overrides).
- `flagDelegated` (B1 fix) applies only to **stored** marks — rule marks always
  render via decoration so `useCustomLabels` can't silently swallow them.

**Glob engine** — `globMatch(pattern, path)` in `src/pure.ts`; supports `**/`
(any depth incl. leading `/`), `*`, `?`, `{a,b}`, `[...]`; no new npm deps
(vsix ships `--no-dependencies`).

**Touch points**
- `decorations.ts`: `matchRule(uri)` public; called when no stored mark;
  `alivetabs.rules` added to config-refresh listener.
- `state.ts::toConfig`: include sanitized `rules` for deep mode.
- `extension.ts` overview: rows for open file tabs matching rules (flag only
  when a rule configured), rendered as `auto` rows (open/re-mark actions only).

## B. `alivetabs.presets` — user presets

```json
"alivetabs.presets": {
  "type": "array", "default": [],
  "items": { "type": "object", "required": ["name","flag","color"],
             "properties": { "name": {"type":"string"},
                             "flag": {"type":"string","maxLength":10},
                             "color": {"type":"string","pattern":"^#?[0-9a-fA-F]{3,6}$"} } },
  "description": "Additional entries in the Set Flag & Color Preset picker."
}
```

Merged after built-ins in `alivetabs.setPreset` (`extension.ts`); invalid
entries skipped. Color normalized via `sanitizeHex`.

## C. Deep mode — flag text

`runtime/alivetabs.js`:
- `cfg.rules` → `matchTab` step 4: glob fallback (same semantics as A).
- `apply()`: for matched `m.flag`, ensure a `span.alivetabs-flag` inside
  `.label-name` honoring `cfg.flagPosition` (prefix/suffix); remove on
  unmark/unmatch. MutationObserver re-entry is idempotent (span reuse).

## D. Pure module + tests

- New `src/pure.ts`: `contrastColor` (moved from `colors.ts`), `sanitizeHex`,
  `escapeCssContent`, `firstGraphemes`, `globToRegExp`/`globMatch`. No `vscode`
  imports → unit-testable from compiled `out/pure.js`.
- `tests/pure.test.js` (CJS, `node:test` + `assert`) — covers hex sanitize,
  contrast, CSS escaping, grapheme truncation, glob edge cases.
- `package.json`: `"test": "node --test tests/"`. Zero new devDependencies.
- Deep-mode `matchTab`/`globMatch` are intentionally duplicated (runtime must
  be a single self-contained file for the `workbench.html` patch).

## E. CI publishing — dropped

CI publishing is out of scope for now: releases are cut manually per the
checklist below (Open VSX via `ovsx` + `.env.local`, GitHub release via API,
VS Code Marketplace by the maintainer).

## F. Open VSX publishing hold — 2026-10-15 — RESOLVED

**Symptom (observed):** every newly published version was accepted by the
registry but landed `active=false` — invisible in the API and marketplace
UI. `ovsx publish` of the same file reported
`already published, but currently isn't active and therefore not visible`.

**Root cause:** Eclipse Foundation's publisher-agreement enforcement —
versions from unsigned publisher accounts get quarantined. Confirmed by
holding versions under **both** `WebieAPP` and `himanverma` namespaces
(account-level hold, not namespace-level). Resolved when the maintainer
signed the Publisher Agreement on open-vsx.org → held versions activated.

**Outcome:**

| Version | Namespace | Final state |
|---|---|---|
| 0.2.0–0.2.3 | `WebieAPP` | live |
| 0.3.0 | `WebieAPP` | activated |
| 0.3.1 | `WebieAPP` | **burned** — unpublished; Open VSX versions are immutable, the number is permanently reserved (admin purge needed to reuse) |
| 0.3.2 | `WebieAPP` | **live — canonical** |
| 0.3.2 | `himanverma` | removed — parallel listing deleted via `ovsx unpublish`; `WebieAPP.alivetabs` stays canonical |

**Lessons:**
- `ovsx unpublish` is destructive — it permanently reserves the version
  number; never use it to "retry" a held version.
- Republishing a held version does NOT reactivate it.
- If new versions go invisible right after `🚀 Published`, check the
  Publisher Agreement status on the open-vsx.org profile first.

**Namespace claim:** resolved 2026-10-15 — `WebieAPP` is a verified
namespace; the unverified-publisher banner is gone from all versions.

---

## Build & release checklist (every release)

1. `npm run compile` + `npm test`
2. `package.json` version bump → CHANGELOG entry
3. `npx @vscode/vsce package --no-dependencies`
4. Commit → `git push origin main` → `git tag vX.Y.Z` → push tag
5. `source .env.local && npx ovsx publish alivetabs-X.Y.Z.vsix`
6. GitHub release via API + upload vsix asset
7. *User*: publish to VS Marketplace manually (`vsce publish`)
