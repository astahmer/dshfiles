# Multi-host validation

Validated 2026-10-05 with fnm's official Node 22.23.3 and installed DSH 0.2.0-rc.2.

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
