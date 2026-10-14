# Repository documentation

This directory holds repository-wide operational guidance. Product and API documentation lives with its owning plugin or toolchain; active design work lives in [`plans/`](../plans/README.md).

| Document                                     | Purpose                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`profile-installs.md`](profile-installs.md) | Local profile installs, pnpm behavior, peer dependencies, and composition.                           |
| [`e2e-testing.md`](e2e-testing.md)           | Test layers, boot smoke, Gherkin journeys, feature catalogs, and run evidence.                       |
| [Incremental checks](incremental-checks.md)  | Unified pnpm workspace, Turbo caching, JJ-aware changed/related tests, and safe fallback boundaries. |
| [`scripts/README.md`](../scripts/README.md)  | Repository-level scripts and their owning workflows.                                                 |

For the complete package guide index, see the [repository README](../README.md#owned-dsh-bundles). For dshx, see the [toolchain documentation index](../tooling/dshx/docs/index.md).
