# @dshfiles/tool-bash

Owned Host fork of DSH's `@deepseek-ai/dsh-tool-bash` package: the model-facing `bash` tool with its background-job
and sandbox-escalation support. Execution, sandboxing, approvals and job hand-off are upstream's, byte for byte.

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), `packages/shell/tool-bash`
- Package: `@deepseek-ai/dsh-tool-bash@0.2.1-rc.2`
- Pinned revision: tag `dsh-v0.2.1-rc.2` (`687f282e8625c6b8d11ff58211a90524be2e4317`)
- License: MIT, see [LICENSE](LICENSE)

## Why a fork

The model-facing result text is built by the package's private `renderResult`; no Host hook can change how a run is
rendered without re-parsing it.

## Local delta

None yet: `src/native` and `locale` equal upstream.

## Wiring

The tool is a child of the `preset-standard` agent preset, not a global Loader row, so this bundle's
`cordis.patch.yml` inserts nothing.

## Updating from DSH

```sh
node scripts/native-fork-diff.mjs tool-bash --to <new-tag>
```

Copy the files listed under `copy`, reapply the local delta to the files under `reapplyDelta`, update this pin and
`native-fork.json`, then type-check, test, build and boot-check in a scratch profile.
