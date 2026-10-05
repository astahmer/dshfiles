# DSHX authoring recipes

These recipes start from working DSH plugins. They show where the domain API
ends and where DSH's panel, settings, tool, and subprocess adapters begin. The
package test command exercises the named consumer; the typecheck command checks
its public DSHX and native contracts.

Run commands from the repository root with the pinned Node version:

```sh
fnm exec --using 22.23.3 pnpm --dir tooling/dshx build
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/<plugin> typecheck
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/<plugin> test
```

## Host-owned operation and safe subprocess

Put the domain operation behind a typed Host boundary. Keep process arguments,
working directory, output limits, cancellation, and redaction explicit rather
than building a shell string. The [Jujutsu plugin](../../../plugins/@dshfiles/jujutsu/src)
uses `defineApi` for typed operations and keeps command execution and repository
state in its own modules.

```sh
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/jujutsu typecheck
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/jujutsu test
```

## Panel with a typed Host API

Define one versioned API contract with Standard Schema input and output. The
Host owns admission, validation, and the operation; the Client uses the same
contract and contributes a panel. Do not expose every API method as an agent
tool: command, panel, and tool adapters each have different invocation and
authorization semantics.

The [MCP Servers plugin](../../../plugins/@dshfiles/mcp-servers/src/api.ts)
shows schema-backed server state and operations. Its
[Client](../../../plugins/@dshfiles/mcp-servers/src/client.tsx) owns panel and
quick-panel UI, while its [Host](../../../plugins/@dshfiles/mcp-servers/src/host.ts)
owns credential resolution and native MCP client lifecycle.

```sh
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/mcp-servers typecheck
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/mcp-servers test
```

## Session-bound UI and an agent tool

Use the native session-scoped slot props for live session data, then call the
same typed Host API from UI and tool adapters. Keep the mutation in one Host
operation so both callers preserve identical validation and durable behavior.

The [queue-reorder Client](../../../plugins/@dshfiles/queue-reorder/src/client.tsx)
reads native `IConversation` and `MessageId` contracts. Its Host
[operation](../../../plugins/@dshfiles/queue-reorder/src/host.ts) moves the
pending inbox entry once; both the UI and `queue_move` tool call it. The
[ordering tests](../../../plugins/@dshfiles/queue-reorder/src/queue-order.test.ts)
exercise movement boundaries and identity preservation.

```sh
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/queue-reorder typecheck
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/queue-reorder test
```

## Settings search and editing

Search the Host-provided settings descriptions and schemas; do not invent a
parallel settings model. Resolve a user's edit to a stable entry and field path,
parse it against the schema, and call the native set or unset operation. Hide
secret paths and their descendants from search results.

The [settings index](../../../plugins/@dshfiles/settings-search/src/settings-index.ts)
and [editor model](../../../plugins/@dshfiles/settings-search/src/settings-editor-model.ts)
separate search and input parsing from the Client view. Their tests cover
described entries, nested reads, typed values, and exact settings operations.

```sh
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/settings-search typecheck
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/settings-search test
```

## Host state, lifecycle, and local processes

Choose state ownership from the data's lifetime. The
[AI Accounts plugin](../../../plugins/@dshfiles/ai-accounts/src/account-runtime.ts)
primes its account store before the first synchronous route read and owns an
account pool in its Host runtime. Its store tests check that boot boundary and
its credential tests ensure rotated tokens update only the intended login.
Keep this file-backed account state separate from optional schema-decoded Host
row config.

For subprocess work, pass executable and argument arrays, bound output, redact
credentials, and own the entire process group. The
[Secret Catalog runner](../../../plugins/@dshfiles/secret-catalog/src/secret-cli-runner.ts)
and its tests cover those boundaries; the
[MCP Servers local-process adapter](../../../plugins/@dshfiles/mcp-servers/src/local-process.ts)
owns server start, stop, and uncertain-exit states.

```sh
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/ai-accounts typecheck
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/ai-accounts test
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/secret-catalog typecheck
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/secret-catalog test
```

## Agent-authorized communication

Capture the native Agent identity from the tool execution context, authorize
each operation at that boundary, and use one Host communication service for
publish, subscribe, and inbox operations. `defineTool` keeps the native input
schema, output schema, rendering, and execution policy visible to DSH.

The [agent communication Host](../../../plugins/@dshfiles/agent-communication/src/host.ts)
is the Agent-facing integration. DSHX's same shared Host communication service
also backs the local [CLI adapter](../packages/dshx/src/communication/cli.ts)
and [MCP adapter](../packages/dshx/src/communication/mcp.ts). The
[file-backed service tests](../packages/dshx/tests/communication-service.spec.ts)
cover principal checks, subscriptions, delivery, notification deduplication,
and acknowledgement. The plugin's [message tests](../../../plugins/@dshfiles/agent-communication/src/messages.test.ts)
check that notification copy does not carry peer text.

```sh
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/agent-communication typecheck
fnm exec --using 22.23.3 pnpm --dir plugins --filter @dshfiles/agent-communication test
fnm exec --using 22.23.3 pnpm --dir tooling/dshx --filter @dshfiles/dshx exec vitest run tests/communication-service.spec.ts
```

## Raw Cordis extension

Use the typed DSHX API when it expresses the operation. When the installed Host
contract has a native service or event that the SDK does not wrap, author an
ordinary `defineHost` or `defineClient` entry, declare its real native `inject`
values, and inspect the active composition before using it. A missing Host
method is a Host limitation; a local interface or cast cannot add that method.
The [Host getting-started guide](./sdk/getting-started.md) shows the raw-context
boundary and the [capability report](./cli-reference.md#inspect) shows which
protocol-2 services are verified, optional, or unavailable.
