# @dshfiles/workbench

Docking workbench for DSH's main slot. Registered panels can move, split, tab, and float without remounting; layout state persists. The [`@dshfiles/editor`](../editor/README.md) package contributes an editor panel.

The workbench opens from the right side panel's own rail; its `headerToggle` setting is off by default so the conversation header stays for thread state.

This is an owned DSH bundle and shared panel registry. Run `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.
