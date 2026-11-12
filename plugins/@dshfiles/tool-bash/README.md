# @dshfiles/tool-bash

Owned Host fork of DSH's `@deepseek-ai/dsh-tool-bash` package: the model-facing `bash` tool with its background-job
and sandbox-escalation support. Execution, sandboxing, approvals and job hand-off are upstream's, byte for byte.

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), `packages/shell/tool-bash`
- Package: `@deepseek-ai/dsh-tool-bash@0.2.2-rc.2`
- Pinned revision: tag `dsh-v0.2.2-rc.2` (`ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`)
- License: MIT, see [LICENSE](LICENSE)

## Why a fork

The model-facing result text is built by the package's private `renderResult`; no Host hook can change how a run is
rendered without re-parsing it.

## Local delta

| File                   | Change                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/render.ts` | every completed run ends with `[exit code: N]`, `0` included; a timeout says how long it waited (`90000ms (1m 30s)`) and suggests a larger `timeoutMs` or `run_in_background: true`; a truncated tail drops its partial first line and says how many whole lines it shows, then the spill path |
| `src/native/index.ts`  | build compatibility only: Cordis declares `FiberState` as an ambient `const enum`, which `verbatimModuleSyntax` cannot import, so `ACTIVE` (`2`) is inlined                                                                                                                                    |

The exit marker keeps upstream's `[exit code: N]` / `[killed by signal: SIG]` form and stays the last line: the
native terminal card (`parseExitStatus`, its exit pill) and `@dshfiles/turn-summary` / `@dshfiles/test-runs` anchor on
it. A signal-killed command already named the signal upstream. Dropping the first line of a truncated tail can drop one
complete line when the cut fell exactly on a line break; the spill file keeps every byte. `src/render.test.ts` covers
each case against the real renderer.

## Wiring

The tool is a child of the `preset-standard` agent preset, not a global Loader row, so this bundle's
`cordis.patch.yml` inserts nothing.

## Updating from DSH

```sh
node scripts/native-fork-diff.mjs tool-bash --to <new-tag>
```

Copy the files listed under `copy`, reapply the local delta to the files under `reapplyDelta`, update this pin and
`native-fork.json`, then type-check, test, build and boot-check in a scratch profile.
