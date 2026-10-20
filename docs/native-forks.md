# Native forks

Plugins here that vendor a whole native DSH package, disable its Loader row and carry a small recorded delta. Why and
how to fork: [replacing native DSH plugins](native-plugin-overrides.md). Each fork's `native-fork.json` is the
machine-readable record (upstream package, pinned ref, path mapping, delta files); its README explains each delta.

| Fork                                                                      | Upstream package                          | Pinned            | Loader row replaced  | Why                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------- | ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`@dshfiles/rich-composer`](../plugins/@dshfiles/rich-composer)           | `@deepseek-ai/dsh-client-ui-conversation` | `dsh-v0.2.1-rc.2` | `ui-conversation`    | the composer bar's injected state is package-private                                                           |
| [`@dshfiles/chat`](../plugins/@dshfiles/chat)                             | `@deepseek-ai/dsh-client-ui-chat`         | `dsh-v0.2.1-rc.2` | `ui-chat`            | mount only the visible transcript rows; collapsed groups mount on first open; inline interrupted-task resume; a notice acknowledgement does not replace the Turn's answer |
| [`@dshfiles/frame-layout`](../plugins/@dshfiles/frame-layout)             | `@deepseek-ai/dsh-client-ui-layout`       | `dsh-v0.2.1-rc.2` | `ui-layout`          | remembered column widths, right-column dock seat, bottom row                                                   |
| [`@dshfiles/session-controller`](../plugins/@dshfiles/session-controller) | `@deepseek-ai/dsh-api-session-controller` | `dsh-v0.2.1-rc.2` | `session-controller` | `session/follow` without provider replay blocks; latest-Turn opening; atomic interrupted-task resume admission |
| [`@dshfiles/subprocess-local`](../plugins/@dshfiles/subprocess-local)     | `@deepseek-ai/dsh-subprocess-local`       | `dsh-v0.2.1-rc.2` | `subprocess`         | the group-exit poll backs off instead of a fixed 15 ms process-table walk                                      |

[`@dshfiles/input-trigger`](../plugins/@dshfiles/input-trigger) also vendors a native package
(`@deepseek-ai/dsh-client-ui-input-trigger`, `dsh-v0.2.0-rc.2` plus a 0.2.1-rc.2 port), but its relative imports were
normalized to `.js`, so it is not byte-identical and has no `native-fork.json`; its delta and update policy live in
its [`UPSTREAM.md`](../plugins/@dshfiles/input-trigger/UPSTREAM.md).

## Checking and updating

```sh
node scripts/native-fork-diff.mjs                         # every fork: vendored files must equal upstream except the recorded delta
node scripts/native-fork-diff.mjs chat --to <new-tag>     # what a bump changes: files to copy, files whose delta must be re-applied
```

The first form fails when a vendored file differs from the pinned ref without being listed in `delta`, when a listed
delta file is back to upstream, or when the fork gained or lost files under a vendored path. Run it after editing a
fork. The second form fetches the new ref into the upstream cache (`~/.cache/dshfiles/deepseek-harness`) and splits
the upstream diff into plain copies and delta files to merge by hand.

To bump a fork: copy the upstream files listed under `copy`, merge the ones under `reapplyDelta`, set
`upstream.version` and `upstream.ref` in `native-fork.json` and the README, run the first form until it is clean, then
build, type-check, test and run the plugin's boot check and journeys.
