# Native forks

Plugins here that vendor a whole native DSH package, disable its Loader row and carry a small recorded delta. Why and
how to fork: [replacing native DSH plugins](native-plugin-overrides.md). Each fork's `native-fork.json` is the
machine-readable record (upstream package, pinned ref, path mapping, delta files); its README explains each delta.

| Fork                                                                      | Upstream package                            | Pinned            | Loader row replaced  | Why                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------- | ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@dshfiles/rich-composer`](../plugins/@dshfiles/rich-composer)           | `@deepseek-ai/dsh-client-ui-conversation`   | `dsh-v0.2.1-rc.2` | `ui-conversation`    | the composer bar's injected state is package-private                                                                                                                                                                                  |
| [`@dshfiles/chat`](../plugins/@dshfiles/chat)                             | `@deepseek-ai/dsh-client-ui-chat`           | `dsh-v0.2.1-rc.2` | `ui-chat`            | mount only the visible transcript rows; collapsed groups mount on first open; inline interrupted-task resume; a turn-error action seat beside Resume for feature plugins; a notice acknowledgement does not replace the Turn's answer |
| [`@dshfiles/frame-layout`](../plugins/@dshfiles/frame-layout)             | `@deepseek-ai/dsh-client-ui-layout`         | `dsh-v0.2.1-rc.2` | `ui-layout`          | remembered column widths, right-column dock seat, bottom row                                                                                                                                                                          |
| [`@dshfiles/session-controller`](../plugins/@dshfiles/session-controller) | `@deepseek-ai/dsh-api-session-controller`   | `dsh-v0.2.1-rc.2` | `session-controller` | `session/follow` without provider replay blocks; latest-Turn opening; atomic interrupted-task resume admission; optional Session-list projection selector; Host-only fork into another Workspace (`continuation-api`)                 |
| [`@dshfiles/workspace-nav`](../plugins/@dshfiles/workspace-nav)           | `@deepseek-ai/dsh-client-ui-workspace`      | `dsh-v0.2.1-rc.2` | `ui-workspace`       | a New thread's composer opens before `session/create` answers: a provisional blank row, the view switched at the click, the Host creates or reuses it in the background                                                               |
| [`@dshfiles/subprocess-local`](../plugins/@dshfiles/subprocess-local)     | `@deepseek-ai/dsh-subprocess-local`         | `dsh-v0.2.1-rc.2` | `subprocess`         | the group-exit poll backs off instead of a fixed 15 ms process-table walk                                                                                                                                                             |
| [`@dshfiles/user-questions`](../plugins/@dshfiles/user-questions)         | `@deepseek-ai/dsh-client-ui-user-questions` | `dsh-v0.2.1-rc.2` | `ui-user-questions`  | an answered `continued` question form stays closed while its claimed reply waits for admission (upstream `69f2241e`, b:270)                                                                                                           |

[`@dshfiles/input-trigger`](../plugins/@dshfiles/input-trigger) also vendors a native package
(`@deepseek-ai/dsh-client-ui-input-trigger`, `dsh-v0.2.0-rc.2` plus a 0.2.1-rc.2 port), but its relative imports were
normalized to `.js`, so it is not byte-identical and has no `native-fork.json`; its delta and update policy live in
its [`UPSTREAM.md`](../plugins/@dshfiles/input-trigger/UPSTREAM.md).

[`@dshfiles/hmr-gate`](../plugins/@dshfiles/hmr-gate) replaces the `client-hmr` row the same way, without vendoring:
it reimplements the transport (route, poll, frame shapes) and adds the compatibility gate, so it carries no
`native-fork.json` either; provenance, the copied-behaviour table and the update policy are in its
[`UPSTREAM.md`](../plugins/@dshfiles/hmr-gate/UPSTREAM.md).

[`@dshfiles/agent-telemetry`](../plugins/@dshfiles/agent-telemetry) is a port of a marketplace plugin, not a native
one: it reimplements `@loongsuite/dsh-plugin` 0.1.3 (Apache-2.0, row `loongsuite-observability`, removed from the seed)
on dshx tracing, so it has no `native-fork.json`; the pinned upstream commit, the kept behaviour, the delta and the
update policy are in its [`UPSTREAM.md`](../plugins/@dshfiles/agent-telemetry/UPSTREAM.md), with upstream's `LICENSE`
and a `NOTICE`.

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
