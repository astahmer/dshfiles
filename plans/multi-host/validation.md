# Multi-host validation

Validated 2026-10-06 with fnm's official Node 22.23.3 and installed DSH 0.2.0-rc.2.

| Check | Result |
|---|---|
| `node --experimental-strip-types tooling/dshx/scripts/smoke-multi-host.mjs` | Passed all six assertion groups; disposable profiles/tunnels cleaned up |
| Focused `vitest run .../tests/platform-cli.spec.ts --maxWorkers=1` | 17 tests passed |
| `pnpm --dir tooling/dshx typecheck` | Passed |
| `pnpm --dir tooling/dshx --filter @dshfiles/dshx build` | Passed |
| `pnpm lint` | Exit 0; 0 errors, 1,414 warnings across current shared checkout |
| Focused Oxlint on changed client/test/smoke script | Exit 0; 0 errors, 53 warnings; includes pre-existing client/test patterns and one script address-narrowing warning |
| Scoped Oxfmt write and `--check` on three changed code files | Passed |

Every command above ran through `fnm exec --using 22.23.3`. Complete transient
logs and POC JSON were retained during this investigation under
`/tmp/dsh-multi-host-research`; they are not a durable artifact dependency.

The initial POC failed before the client repair because installed native RPC
requires named business arguments, while DSHX sent positional arrays. The repaired
client and its in-repository custom transport adapters now use named objects.
WebSocket follow received the same repair. Generated native descriptors were
inspected for argument names, never hand-edited.

No whole-suite or unrelated plugin tests were run. Formatting was restricted to
owned code paths to preserve concurrent changes in this shared checkout.
Repository warnings were not attributed to this change; the full checkout already
contains other work. No package dependency or lockfile change was needed.

The POC proves HTTP/session and WebSocket/history access through a real loopback
byte forwarder, session namespace isolation, token rejection, state surviving
tunnel loss, and history recovery after restarting a runtime with the same home.
It does not exercise SSH cryptography/authentication, a second physical machine,
agent/model turns, filesystem/process tools, native terminals, LSP, MCP, browser
composition or supervised remote startup. The interrupted mutation test drops the
connection before sending; admitted mutations with lost replies remain an open
failure-injection acceptance gate.

## P1 — real remote acceptance (2026-10-05, VPS)

Target: documented `deploy@` Hetzner runtime, reached only through the
host's Tailscale address (direct public SSH refuses the key; the tailnet
route is the trusted path). Provisioned under `/home/deploy/dsh-mh`:

- official Node `v24.20.0` linux-x64 tarball from nodejs.org, unpacked in
  `dsh-mh/node`, `node -v` verified remotely; no source build, no global
  install, no shared Node touched.
- official `@deepseek-ai/dsh@0.2.0-rc.2` from npm into `dsh-pkg`
  (`dsh-pkg/node_modules/.bin/dsh --version` returned `0.2.0-rc.2`).
- disposable runtime: `DSH_HOME=/home/deploy/dsh-mh/runtime-a-home`,
  loopback bind, `--port 0`, supervised by a transient systemd user unit
  (`systemd-run --user --unit=dsh-mh-a …boot-remote.sh`).
- workspace: `/home/deploy/dsh-mh/workspace`, owned by `deploy`.
- model route for the agent-turn gate: the owned `@dshfiles/ai-accounts`
  plugin runs on the remote runtime with a `go-free` opencode-go draft in
  `/home/deploy/.dsh/plugins/ai-accounts/accounts.json` (key env
  `OPENCODE_API_KEY`, free-model entitlement resolved live) delivering the
  `longcat-2.0` model through the OpenCode Go upstream.

Verified gates (all assertions executed by
`tooling/dshx/scripts/smoke-multi-host-ssh.mjs` with tokens redacted in its
output, plus a follow-up manual agent-survival run):

| Gate | Result |
|---|---|
| Placement (local `dsh` + remote runtime, isolated parallel sessions) | Passed — same workspace path stays in separate runtime/session namespaces |
| Remote session creation + history over SSH-tunnelled native API | Passed |
| Remote PTY: spawn in workspace cwd, screen snapshot frames, same-attachment write, foreign-attachment resize rejected, owning-attachment resize accepted, exit state `exited` | Passed |
| Remote workspace marker file written only through the remote PTY shell; absent locally | Passed |
| Tunnel loss → • `rpc-unreachable` on stale client, • runtime stays alive, • rebuilt tunnel restores native access with the same cookie, • no replayed mutation | Passed |
| Runtime restart (systemd): fresh token, same cookie still works, workspace/session identity + history preserved, stale handles rebuild | Passed |
| Authentication: wrong token rejected, dead forwarded endpoint fails closed, loopback-only exposure confirmed on remote `ss` | Passed |
| Agent continuity (the one model turn): remote session with `go-free`/`longcat-2.0`, tunnel dropped and all UI subscribers torn down mid-turn, agent completed on the remote runtime, persisted assistant `DONE` and title recovered after reconnect | Passed |
| MCP: credential-free local stdio fixture server registered in the remote profile patch via native `@deepseek-ai/dsh-mcp-client`, `active` phase | Passed |
| LSP | No advertised remote LSP contract — recorded as UNSUPPORTED, no support claim. Separate gate promised only when the installed runtime advertises a matching LSP |

Discovered facts recorded for P2 design:

- The runtime cookie survives a restart (durable signing authority under the
  runtime home) so reconnecting callers must verify identity facts, not just
  reachability; a stale cookie is not proof of authenticity.
- Without loginctl linger, systemd user services die when the last session
  ends; the smoke holds a detach (`ssh -fN`) session, which is exactly the
  bootstrap lifetime a real connector must keep.
- dshx host artifacts had to run the server environment: a bare
  `process.env.X` in plugin source compiled to an empty-object lookup when
  Vite 8 resolved `node:process` through the browser-external shim. The fork
  now builds Host with `build.ssr: true`
  (`tooling/dshx/packages/dshx/src/compiler/host/build.ts`).
- The ai-accounts additionalModelIds field lost its zod default in earlier
  bundles; runtime store reads silently discarded the whole accounts file
  instead of reporting the defect.

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
| P4 browser flow | Online host switching and session creation across local and remote runtimes passed earlier. Pi persistent runtime opened in an isolated browser origin; after a stale view was closed, reopening loaded the current DSH UI and its retained workspaces and sessions. AI Accounts showed the OpenCode Go profile enabled with 30 models and credentials present in the service environment. The Go models endpoint returned HTTP 401 with the installed credential, so no model turn was accepted. Approval, upload, and terminal interaction remain unverified; VPS PTY passed through the native CLI path in P1. |
| Engineering checks | Full root `pnpm check` passed on official Node 22.23.3. DSHX passed (43 files / 442 tests), create-dshx passed (2 files / 21 tests), all 12 plugin bundles passed contract, build, typecheck, and test checks, and the offline boot check activated all 12. Knip passed; Oxlint exited 0 with warning-only antislop findings and no errors; Oxfmt matched all 405 files. |
| P5 second machine | Passed: official Node 24.20.0 ARM64 was signature-checked and used for Pi; VPS x64 and two isolated local runtimes were online concurrently. Pi package install used prebuilt artifacts with lifecycle scripts disabled. |
| P5 profile source | Isolated nixfiles workspace contains one owned bundle and patch row; the local link resolves to this plugin and package name matches. Scratch `--dump-config` saw the patch row, but activation was skipped because the scratch profile had no `node_modules`. This remains source-composition evidence only; shared web profile was not edited or restarted. |
| P5 durable deployment | Partial: `home-infra-dsh-pi-runtime` now pins release `2026-10-06-dsh-0.2.0-rc.2-1a3edab5` to source change `1a3edab54f52` and deploys the persistent Pi service as a systemd user unit. The release staged from official ARM64 artifacts and activated successfully; rollback behavior has not been exercised. |
| P5 provider credential | Alias `opencode-go-pi` maps to `OPENCODE_GO_PI`; the deployment helper writes it as `OPENCODE_API_KEY` in the protected runtime environment file. The account profile renders as authenticated because the environment variable is present, but the Go models endpoint returned HTTP 401 with the installed key and Pi session/user-agent headers. Credential acceptance and any model turn remain unverified. |

Persistent Pi systemd user service remains active on the pinned release; the T3 manager remains open. The Pi runtime view was closed and reopened during validation. Remote journals and test homes remain retained; no shared DSH 3080 process or original VPS runtime was touched.

The full plugin check now builds bundles before running tests that import their
built entries. It also restores the shortcuts keyboard suite; that regression
coverage caught and fixed checkbox targets being treated as editable fields.
