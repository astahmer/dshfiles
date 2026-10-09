# ADE — user decisions (2026-10-09)

Answers to the open questions in [README.md](README.md). These override the plan where they differ.

1. **Editor: Monaco**, not CodeMirror ("the DX is much better"). Phase 2 must solve Monaco workers under the dshx
   single-chunk contract: inline worker sources and start them from `Blob` URLs (or run language services on the main
   thread for small files), lazy-load Monaco only when an editor opens, and keep its weight out of plugins that don't
   open files (dedicated `@dshfiles/editor` plugin, not plugin-ui). Measure the bundle and first-open time; reuse the
   slim shiki setup only if Monaco's own tokenizers are dropped in favour of it.
2. **Editor placement: both, user-movable.** Build on a docking layer rather than fixed slots: **Trellis**
   (<https://trellisui.com/>, `@danfessler/trellis`) as a foundational "move anything anywhere" plugin. Already
   scouted in [reference-feature-additions.md](../reference-feature-additions.md) I01 and
   [software-additions-roadmap.md](../software-additions-roadmap.md) 2A: verify its exact licence, React 18
   integration, keep views mounted when moved (no remount, draft/focus/subscriptions preserved), saved named
   layouts, reset/recovery for removed plugins. Start with our own registered panels (editor, jj, file tree, secret
   catalog…), not DOM-reparenting native DSH UI. This becomes a Phase 2 prerequisite ("2.0 Docking probe").
3. **Saving files must work.** Prefer existing Host seams (plugin host-side file write via Node `fs` inside the
   session workspace, guarded by DSH tool permissions/approval); use the fork only if no seam exists. Any fork change
   stays minimal and isolated (one package, documented in `tooling/dsh-core/FORK.md`) so upgrading to new DSH
   releases remains a rebase of a small patch set.
4. **No upstream proposals** to the DSH maintainers; capability gaps are solved locally.
5. **Editor upgrade path:** keep the editor behind a small `openFile`/editor interface in `@dshfiles/editor`, so it can
   move to `@codingame/monaco-vscode-api` + `monaco-languageclient` (VS Code themes/keybindings/extensions, LSP) when
   language-server features land, or down to CodeMirror 6 if weight ever matters more than DX. No lighter editor
   matches Monaco's VS Code DX today.
