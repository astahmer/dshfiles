---
name: live-performance-audit
description: Measure where a slow DSH interaction (thread switch, New thread, any request over 250 ms) actually spends its time on the live Host and browser, then fix it at the owner — usually an owned plugin or a fork of the native Loader row, not a new plugin or a core patch. Use before planning any performance work, whenever the user reports seconds-long requests or a laggy GUI, and to prove a fix with before/after numbers.
---

# Live performance audit

Static audits, scratch fixtures and request logs alone have repeatedly produced the wrong plan here (new helper
plugins, "core fork needed"). Start from the live GUI, attribute every millisecond, then fix the owner. The budget is
250 ms per interaction and per request on a Host that is not stalled.

## 1. Measure the live instance (read-only, no restart)

```sh
S=.agents/skills/live-performance-audit/scripts
node $S/host-lag.mjs 60                       # is the Host event loop itself blocked?
node $S/switch-probe.mjs 10                   # per sidebar click: composer, history, long tasks, DOM, bytes, requests
REQUESTS=1 node $S/switch-probe.mjs 5         # every request a click fires, with its time
MATCH='^Exact thread title' DUMP=snap.json node $S/switch-probe.mjs 1 && node $S/snapshot-bytes.mjs snap.json
# Resolve and verify exactly one Host PID from the current runtime first:
node $S/host-cpu-profile.mjs "${DSH_HOST_PID:?set the verified Host PID}" 60   # SIGUSR1 inspector, closed afterwards
```

Use Node from `.node-version`. Discover the actual live URL/profile rather than assuming a particular port.
The probes accept `LAUNCH_URL`; keep that token-bearing value in private process configuration and out of logs/source.
The profiler attaches to the live process without restarting it; tell the user before
attaching. Never measure while a build or e2e run of yours loads the machine, and check `uptime`: a load average far
above the core count (leaked `dshx-boot` scratch Hosts, editor jj servers) inflates every number.

## 2. Classify each cost

| Signal                         | Meaning                                                        | Where to look                                              |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `host-lag` p99 or max ≫ 250 ms | Host event loop blocked; every request queues                  | CPU profile, inclusive frames                              |
| request time ≫ its server time | browser queue (six HTTP/1.1 connections) behind other requests | count requests per interaction                             |
| large `ws=`/HTTP bytes         | payload                                                        | `snapshot-bytes.mjs` on the dumped frame                   |
| long tasks, large `dom=`       | rendering on the main thread                                   | DOM nodes per row (`row.getElementsByTagName('*').length`) |

## 3. Fix at the owner

- **Owned plugin**: fix it there with a regression test that fails without the fix.
- **Native client package** (transcript, composer, …): fork the Loader row as an owned plugin — vendored
  byte-identical, small recorded delta, stock row disabled in the bundle patch. `@dshfiles/rich-composer` and
  `@dshfiles/chat` are the precedents; see [native plugin overrides](../../../docs/native-plugin-overrides.md). This
  is the supported route, not a core patch, and it is often the only real fix.
- **Host core** (`session/follow`, `session/list`, settings services): record a row in
  [`plans/dsh-host-gaps.md`](../../../plans/dsh-host-gaps.md) with the measured numbers. Never patch core.

## Traps found so far

- dshx `SettingsScope.get()` called `settings.describe()`, which recomposes the profile from disk; plugins read
  settings per Session event (12 % of Host CPU). Cached on the Loader entry identities.
- Input-trigger sources with `warm()` prefetch their catalog on every composer mount, i.e. every thread switch.
- `refetchOnMount: 'always'` or a default stale time on queries mounted by the composer refetch per switch.
- Collapsed transcript groups kept every row mounted (hidden, for browser find): 42k DOM nodes per thread.
- `session/follow` sends provider replay state (thinking signatures) twice per assistant message: 65 % of the bytes
  on Anthropic threads.
- `session/follow` sent `replayState.blocks` (thinking signatures) twice per assistant message, and `session/list`
  decompressed every cold Session log per call; both are fixed in the `@dshfiles/session-controller` fork.
- Every jj spawn loads the repository view (80–340 ms on a store with dozens of workspaces): key `--ignore-working-copy`
  reads on the store's `op_heads/heads` listing instead of a clock.
- An auto-load sentinel at the top of a transcript of collapsed Turns stays in range page after page; gate it on the
  reader leaving the tail.
- Scratch `dshx dev up` profiles do not reproduce private live data or user-layer patches. If representative
  transcript/profile data is necessary, obtain explicit authorization for a private isolated copy, verify the
  raw-core launcher's environment isolation, and keep that copy and its evidence out of the repository. Never
  assume APFS clone support or that a local wrapper honors `HOME`/`DSH_HOME` overrides.
- The Host's "N entries did not activate … fiber state 1" line is a boot-time snapshot; rows still loading then
  usually activate. Check the browser boot graph (`window.__DSH_BOOT__`) and console for client-side failures.
- On a starved machine (load ≫ cores) the 1 ms sampler is descheduled: sample deltas reach 100–250 ms and land on
  whatever frame was on the stack, so self time per frame is noise. Check `uptime` and the delta distribution before
  trusting a single hot frame. On 2026-10-21 (load 54–82: three leaked `dshx dev up` instances plus e2e runs) a
  `session/create` took 6.5 s with no regression in `main`; the Host lagged up to 1.8 s because the machine did.
- Confirm a suspected hot path by counting it on the live Host instead of trusting the profile: a conditional
  breakpoint whose condition increments a global and returns `false` counts calls without pausing (it showed
  28 `AbortSignal.timeout` fires in 20 s, not the thousands a misread profile implied).

Record findings and before/after tables in [`docs/performance.md`](../../../docs/performance.md).
