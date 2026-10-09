# ADE editor (`@dshfiles/editor`) — Phase 2 notes

Implements [decisions.md](decisions.md) items 1, 3, 5 and [README.md](README.md) P2.3–P2.6.

## Monaco under the dshx single-chunk contract

| Concern | Approach |
|---|---|
| Version | `monaco-editor` 0.57.0 (published 2026-09-24), pinned in this plugin only. |
| Entry | `editor/editor.api` + `features/register.all` + `languages/definitions/register.all` (Monarch tokenizers) + `languages/features/json/register`. No `editor.main`/`index` (they pull the LSP client and the TS/CSS/HTML language services). |
| Workers | `?worker&inline` for `editor.worker` and `json.worker`: Vite inlines each worker build as a JS string and starts it from a `Blob` URL. `MonacoEnvironment.getWorker` returns them; nothing else creates workers. |
| Bundler-only worker paths | `monaco-vite.ts` rewrites Monaco's `new Worker(new URL(…, import.meta.url))` / `new URL(…, import.meta.url)` fallbacks to `undefined` so Vite emits no worker chunk, and drops the inlined workers' standalone `.js.map` assets (Vite emits them when `sourcemap: true`). |
| CSS | Monaco's per-module `.css` imports resolve to an empty module, so the folded Tailwind sheet stays byte-identical to every other plugin's and the shared-sheet dedupe keeps working (`style[data-dshx-shared-css]` hash equal). The prebuilt `min/vs/editor/editor.main.css` (390 KB, codicon font inlined) is a string module injected as `style[data-dshfiles-monaco]` on the first editor open and removed on plugin dispose. |
| Lazy init | `import('./monaco-engine.js')`: with `codeSplitting: false` rolldown inlines it as a lazy `init_*()` wrapper, so Monaco's modules are evaluated, styles injected and workers started only when the first file opens. No extra chunk. |
| Theme | `dshfiles-light` / `dshfiles-dark` (inherit `vs` / `vs-dark`, background from `--dsw-alias-bg-base` when it is a hex color); follows `body[data-ds-dark-theme]` through a MutationObserver. |
| Editor seam | `code-editor.ts` (`CodeEditorEngine` / `CodeEditorHandle`: show, reset, close, reveal, snapshot+version, markSaved, setDark). Only `monaco-engine.ts` imports Monaco; swapping to `@codingame/monaco-vscode-api` or CodeMirror 6 is a new engine module. |

## Measurements (2026-10-09, M-series, scratch instance on :3199, production build)

| Metric | Value |
|---|---|
| `dist/client.js` | 5.95 MB minified, 1.59 MB gzip |
| of which inlined workers | editor worker 297 KB, JSON worker 424 KB (string literals) |
| `dist/index.js` (host) | 56 KB |
| Shared Tailwind sheet | unchanged size; hash identical to other plugins once all are rebuilt |
| First open: `import()` + `monaco.editor.create` | 89–126 ms (`[data-editor-surface]` `data-first-open-ms`) |
| Open-file event → content painted (first file, includes `readBytes` round trip) | ≈ 160 ms – 1 s depending on Host connection warmup |
| Monaco styles before first open | none (lazy) |

The 5.95 MB is downloaded and parsed with the plugin factory on every page load even when no file is opened
(evaluation is deferred, parsing is not). Trimming options if it matters: fewer basic languages, drop the JSON
worker, or select individual `features/*/register` instead of `register.all`.

## What is proven (scratch DSH on :3199, own `DSH_HOME`, workspace under the scratchpad)

- Boot: no "did not activate" lines with `@dshfiles/editor`, `@dshfiles/jujutsu`, `@dshfiles/workbench`.
- Blob workers run under DSH's CSP: JSON validation squiggles appear while typing (worker-backed).
- `dshfiles:open-file` with `{ path, line }` opens the right-panel tab or the workbench panel, reveals the line.
- Tree lists the session workspace through `workspaceFiles.list`; files load through `readBytes` (exact bytes, so
  trailing newlines survive a save).
- Dirty dot, ⌘S and the Save button, first-save confirmation, atomic write on disk (no temp file left).
- External change on disk: clean buffer reloads live (`workspaceFiles.changes`); dirty buffer shows the
  "Changed on disk" banner; saving then raises the conflict dialog; "Reload from disk" resets the buffer.
- Host write safety (`src/write-file.test.ts`, 12 tests): relative and absolute traversal, symlinked directory
  escape, symlink target, directories, missing parent, size cap, `.git`/`.jj` internals, conflict, overwrite,
  mode preservation, symlinked root prefix.
- Host dist imports under Node 22.23.3.

## Binary files

Images (png, jpg, gif, webp, svg) render as an `<img>` from a `blob:` URL; other files that are not NUL-free UTF-8
show their size and "Binary file". Neither reaches Monaco, both are read-only. "Open" / "Show file location" use the
Session Remote's `openWorkspacePath` and appear only when `canOpenWorkspacePath` says the Host has a desktop. Files
over the Host's 32 MB complete-read cap fall back to `stat` for the size.

## Gaps

- **Approval:** `ctx.approval.request` needs an Agent with an open turn (it audits into that session's log), so a
  user-initiated save from the UI cannot use it. The panel asks once per open tab instead; the Host-side guard is
  workspace confinement + conflict detection. A real gate needs a Host approval path for UI actions.
- No check of the session's busy state before writing (conflict detection covers concurrent agent edits).
- Writes resolve the workspace root from the session header (`cwd`); a session without one cannot save.
- Hashing uses `crypto.subtle` (secure context: localhost or https).
- Open tabs live in memory: an HMR reload of the plugin (any rebuild of `dist/client.js`) drops them.
- Tab identity: paths are normalized (`./`, `//`, `..`) and made workspace-relative against the session `cwd` and
  the symlink-resolved root learnt from Host `absolutePath`s; two spellings that still differ merge into one tab once
  both report the same `absolutePath`.
- Right panel and workbench share the per-session active tab; each surface keeps its own Monaco view state.
- Workbench detection is heuristic (another panel id than ours registered); without the workbench plugin the
  setting falls back to the right panel.
- No TS/CSS/HTML language services, no LSP (decision 5 upgrade path), no Host `/diff` header wiring.
- File links: `@dshfiles/editor/file-link` claims `dsh-resource://file/session/**` (`extension` band, `canOpen` drops
  pdf/office/epub and `absolute/…`). Its body is a redirect: open in the editor, then close the sidebar tab, so a
  persisted layout holding one replays the open once on reload. The `openFileLinks` setting is mirrored in
  localStorage for the synchronous `canOpen`, and only refreshes while an editor surface is mounted.
