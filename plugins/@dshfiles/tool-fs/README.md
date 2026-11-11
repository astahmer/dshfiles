# @dshfiles/tool-fs

Owned Host fork of DSH's `@deepseek-ai/dsh-tool-fs` package: the model-facing `read`, `write`, `edit` and `read_image`
tools over the `ctx.fs` seam. Sandbox checks, approvals and the `fs/observed` receipts the fs-observation policy reads
are upstream's, byte for byte.

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), `packages/fs/tool-fs`
- Package: `@deepseek-ai/dsh-tool-fs@0.2.1-rc.2`
- Pinned revision: tag `dsh-v0.2.1-rc.2` (`687f282e8625c6b8d11ff58211a90524be2e4317`)
- License: MIT, see [LICENSE](LICENSE)

## Why a fork

`read`'s argument parsing, window rendering and not-found error live in the package's private functions; no Host hook
can change them. `tools/pre-execute` can only allow, deny, ask or cancel, and a `tools/post-execute` rewrite would have
to read the file itself, outside the sandbox check and without an `fs/observed` receipt.

## Local delta

None yet: `src/native` and `locale` equal upstream.

## Wiring

The tools are a child of the `preset-standard` agent preset, not a global Loader row, so this bundle's
`cordis.patch.yml` inserts nothing.

## Updating from DSH

```sh
node scripts/native-fork-diff.mjs tool-fs --to <new-tag>
```

Copy the files listed under `copy`, reapply the local delta to the files under `reapplyDelta`, update this pin and
`native-fork.json`, then type-check, test, build and boot-check in a scratch profile.
