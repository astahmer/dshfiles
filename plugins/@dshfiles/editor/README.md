# @dshfiles/editor

Monaco-based workspace file editor for DSH. Provides a workspace tree, editor tabs, open-from-anywhere integration, and confined file saving through Host APIs. Its `openFileLinks` preference appears as a native switch in Settings → General; Settings Search can route directly to that control when the Host supports native settings targets.

Depends on `@dshfiles/workbench` for its dockable panel and `@dshfiles/plugin-ui` for shared UI. Build, test, and typecheck with `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.
