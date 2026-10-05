P1 and P2 exit gates satisfied. P3 through P5 have the evidence and remaining
gates recorded below.

## P2–P5 — multi-host implementation and rollout evidence (2026-10-06)

| Gate | Result |
|---|---|
| P2 identity and CLI | Passed on one manager: two isolated local runtimes, one Pi runtime, and one VPS runtime remained separately qualified. Each opened `/tmp/dsh-mh-shared-20261005` under a distinct native workspace and session identity. CLI created an additional Pi session. A duplicated local host selector returned `runtime-ambiguous`; an unknown runtime returned `runtime-not-found`. |
| P2 authentication | Passed: a deliberately altered launch token returned `authentication-failed` and did not add the runtime to the directory. |
| P2 persistence | Passed on Pi: a controlled service restart retained its runtime identity, workspace, and sessions. Local directory tests cover concurrent writes, atomic private writes, migration, and corrupt-directory preservation. |
| P3 outage and recovery | Passed: stopping only the scratch Pi service returned stale `gateway-unreachable`; VPS and both local runtimes remained online. Restarting the Pi service restored the same runtime identity and its workspace/session inventory. |
| P3 protocol and host-key rejection | Runtime identity schema pins protocol version `1`; the focused regression check rejects version `2`. A live Pi connection through the real SSH connector and OpenSSH rejected a deliberately mismatched temporary known-host key as `host-key-rejected`; the temporary key store and wrapper were discarded without changing saved SSH trust. |
| P3 admitted-mutation loss | Synthetic failure injection passed through `connectGateway`/`callNativeRpc`. A second live proof used the real SSH connector to Pi: a test shim read the successful remote response, dropped it before the caller received it, got `unknown-mutation-outcome`, then listed exactly one new blank session with no replay. No model ran. Three additional blank Pi scratch sessions from the two earlier exploratory calls and this proof remain in the retained scratch home. |
| P4 browser flow | Online host switching and session creation across local and remote runtimes passed earlier. A prior report says the persistent Pi view closed and reopened with its retained workspaces and sessions. Later collaborative preview evidence showed a local scratch runtime as stale while stopped, then online after restart and re-registration; a Pi runtimeOpenView lease opened the remote UI in a distinct loopback origin with its scratch workspace and zero console errors. Approval, upload, terminal interaction, popup close/reopen as a distinct flow, and an accepted model turn remain unverified. VPS PTY passed through the native CLI path in P1. |
| Engineering checks | An earlier full root `pnpm check` passed on official Node 22.23.3: DSHX 43 files / 442 tests, create-dshx 2 files / 21 tests, all 12 plugin bundles passed contract/build/typecheck/test, and the offline boot check activated all 12; Knip passed, Oxlint had warning-only antislop findings, and Oxfmt matched 405 files. Later focused source checks passed: MultiHost 6 files / 20 tests; DSHX 43 files / 447 tests and focused 5 files / 52 tests, followed by typecheck/build; Oxfmt passed on 42 selected files and scoped Oxlint had 281 warnings without errors. These are source-run results; the merged tree still needs focused validation. |
| P5 second machine | Passed: official Node 24.20.0 ARM64 was signature-checked and used for the disposable Pi runtime; VPS x64 and two isolated local runtimes were online concurrently. Pi package installation used prebuilt artifacts with lifecycle scripts disabled. |
| P5 profile source | Isolated nixfiles workspace contains one owned bundle and patch row. Its local link resolves to this plugin and package name matches. Scratch `--dump-config` saw the patch row, but activation was skipped because the scratch profile lacked `node_modules`; this is source-composition evidence only. The shared web profile was not edited or restarted at that time. |
| P5 durable deployment | Conflicting source reports remain: one says `home-infra-dsh-pi-runtime` pinned release `2026-10-06-dsh-0.2.0-rc.2-1a3edab5` and activated a systemd user unit; later ownership evidence says the infrastructure repo is a scaffold, nixfiles manages neither remote, the Pi is under a separate Swarm setup, and only scratch user units were used. Durable declaration, active service, upgrade, and rollback remain unverified. |
| P5 provider model turn | No accepted model turn is recorded in the available source evidence; provider acceptance remains unverified. |

Source evidence conflicts on whether the Pi systemd user service is a persistent deployment or only a scratch unit, so durable activation remains pending. The Pi runtime view was reported closed and reopened in one run; a later runtimeOpenView proof used a separate origin. Remote journals and test homes remain retained; no shared DSH 3080 process or original VPS runtime was touched during this integration.

The full plugin check now builds bundles before running tests that import their
built entries. It also restores the shortcuts keyboard suite; that regression
coverage caught and fixed checkbox targets being treated as editable fields.


A separate validation summary reported that temporary local managers and owned scratch units were stopped after testing; its UI proof restarted only the local scratch runtime. No shared DSH 3080 process or original VPS runtime was touched during this integration.
