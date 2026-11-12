# @dshfiles/tool-fs

Owned Host fork of DSH's `@deepseek-ai/dsh-tool-fs` package: the model-facing `read`, `write`, `edit` and `read_image`
tools over the `ctx.fs` seam. Sandbox checks, approvals and the `fs/observed` receipts the fs-observation policy reads
are upstream's, byte for byte.

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), `packages/fs/tool-fs`
- Package: `@deepseek-ai/dsh-tool-fs@0.2.2-rc.1`
- Pinned revision: tag `dsh-v0.2.2-rc.1` (`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`)
- License: MIT, see [LICENSE](LICENSE)

## Why a fork

`read`'s argument parsing, window rendering and not-found error live in the package's private functions; no Host hook
can change them. `tools/pre-execute` can only allow, deny, ask or cancel, and a `tools/post-execute` rewrite would have
to read the file itself, outside the sandbox check and without an `fs/observed` receipt.

## Local delta

| File                        | Change                                                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/read.ts`        | `offset` accepts a negative integer to read from the end (`-50` = the last 50 lines, at most `limit`); the parameter description says so; the call card titles it `(last 50 lines)`                                         |
| `src/native/read-render.ts` | an offset past the end returns the file's last lines (at most 50, and `limit`) under a `(Offset N is past the end of the file (T lines); …)` line instead of failing; a shortened line never keeps half of a surrogate pair |
| `src/native/read-target.ts` | a missing file's error adds `Did you mean: …?` from `src/missing-path.ts`                                                                                                                                                   |
| `src/missing-path.ts`       | owned: close names in the requested directory (other case, other extension, one or two typos), then files with the same name elsewhere in the project                                                                       |

Reading from the end keeps only the last lines while it scans, so memory stays bounded by `limit`; the byte cap drops the
earliest of them first. The `fs/observed` receipt and the sandbox path are unchanged: the window is still computed from
one `ctx.fs` read after one stat. Suggestions list directories through `ctx.fs.listDir` only on a miss: the requested
directory, then a breadth-first walk of the Session's directory that skips hidden, `node_modules`, `dist`, `build`,
`target` and `coverage` directories, stops at depth 8, 2,000 directories or 5 hits. `read_image` shares the not-found
path, so it suggests the same way. `src/read.test.ts` runs the real `read` tool over `@deepseek-ai/dsh-fs-local` on a
temporary directory; `src/missing-path.test.ts` covers the name ranking, other case included (macOS file systems are
case-insensitive, so the integration test cannot miss on case).

## Wiring

The tools are a child of the `preset-standard` agent preset, not a global Loader row, so this bundle's
`cordis.patch.yml` inserts nothing.

## Updating from DSH

```sh
node scripts/native-fork-diff.mjs tool-fs --to <new-tag>
```

Copy the files listed under `copy`, reapply the local delta to the files under `reapplyDelta`, update this pin and
`native-fork.json`, then type-check, test, build and boot-check in a scratch profile.
