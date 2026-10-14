# Typed API

**Status: API Candidate**

**Shared entry: `@dshfiles/dshx/api`**

**React Hooks: `@dshfiles/dshx/client`**

## Define a contract

```ts
import { defineApi, method } from "@dshfiles/dshx/api";

export interface Status {
  readonly project: string;
  readonly requestCount: number;
}

export const statusApi = defineApi({
  id: "status",
  version: 1,
  methods: {
    get: method<void, Status>(),
    refresh: method<{ readonly force?: boolean }, Status>(),
  },
});
```

`id` is a stable single segment containing letters, numbers, `.`, `_`, or `-`; `/` is rejected. `version` is a positive integer. Contracts are browser-safe and may be imported by both Host and Client source.

```ts
method<ClientInput, ClientOutput>(): ApiMethodDefinition<
  ClientInput,
  ClientInput,
  ClientOutput,
  ClientOutput
>
```

## Standard Schema transforms

`method({ input, output })` accepts `@standard-schema/spec` v1 schemas. `InferInput` and `InferOutput` create four distinct stages:

```ts
ApiMethodDefinition<ClientInput, HostInput, HostOutput, ClientOutput>;
```

```ts
import { z } from "zod";
import { defineApi, method } from "@dshfiles/dshx/api";

const input = z.object({
  force: z.enum(["yes", "no"]).transform((value) => value === "yes"),
});

const output = z.object({
  startedAt: z.date().transform((value) => value.toISOString()),
});

export const runtimeApi = defineApi({
  id: "runtime",
  version: 1,
  methods: {
    refresh: method({ input, output }),
  },
});
```

In this example the Client sends `{ force: 'yes' | 'no' }`, the Host handler receives `{ force: boolean }`, the handler returns `{ startedAt: Date }`, and the Client receives `{ startedAt: string }`.

Schemas run once at the authoritative Host boundary:

```text
Client JSON -> input schema -> Host handler -> output schema -> Client JSON
```

The Client does not run the schemas again. Validation issues, a missing Standard Schema result value, non-JSON transport values, or an output that violates the schema become contract errors.

## Implement every method on the Host

```ts
import { defineHost } from "@dshfiles/dshx/host";
import { statusApi } from "./status-api.js";

let requestCount = 0;

const statusHost = statusApi.host({
  async get({ ctx, signal }) {
    signal.throwIfAborted();
    return { project: String(ctx), requestCount: ++requestCount };
  },
  async refresh({ input, signal }) {
    signal.throwIfAborted();
    return {
      project: input.force ? "refreshed" : "ready",
      requestCount: ++requestCount,
    };
  },
});

export default defineHost({
  apis: [statusHost],
});
```

Each handler receives `{ input, ctx, signal, peer, caller }`; `caller` says whether a Client, another Host plugin or the agent made the call (see [One registry](#one-registry-other-plugins-clients-and-the-agent)). `.host()` requires exactly the contract's method keys: missing and extra handlers are type errors and are also rejected at runtime. `authority` defaults to `loopback`; pass `{ authority: 'trusted-host' }` only when the official Connection policy requires it.

## Host transport and authentication

dshx registers one exact `POST` route per API method through the native
`connection.fetch.register()` service. The routes live under DSH's authenticated
`/api` handler. Client calls use the native Connection RPC service with the same
channel and method path; dshx handles the RPC envelope, method match, request
validation, response correlation, and JSON response. This keeps plugin APIs
inside Connection's admission and browser-authentication checks instead of
adding a separate loopback HTTP endpoint. Route registrations are disposed with
the Host plugin, and duplicate paths are rejected by Connection.

The typed API owns this transport. Plugin code should declare contracts and
handlers with `defineApi()` and `defineHost()` rather than registering raw
`connection.fetch` routes or reaching into `webServer` directly.

## Imperative Client calls

```tsx
import { useApi } from "@dshfiles/dshx/client";
import { statusApi } from "./status-api.js";

function Controls() {
  const api = useApi(statusApi);

  async function refresh(signal: AbortSignal) {
    const current = await api.get();
    const cancellable = await api.get(undefined, { signal });
    const next = await api.refresh({ force: true }, { signal });
    return { current, cancellable, next };
  }

  // ...
}
```

Every method uses `(input, options)`. For a no-input method, pass `undefined` before `{ signal }`; `api.get({ signal })` is intentionally not an overload because it conflicts with legal object inputs.

`api.safe.<method>()` returns a discriminated result instead of throwing:

```ts
type ApiCallResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError };
```

## `useApiQuery`

```tsx
const status = useApiQuery(statusApi, "get", {
  enabled: true,
  signal,
});

const refresh = useApiQuery(statusApi, "refresh", {
  input: { force: true },
  enabled,
  signal,
});
```

Input methods require `input`; no-input methods omit it. The result is a strict union:

```ts
type ApiQueryResult<T> =
  | {
      status: "pending";
      fetchStatus: "idle" | "fetching" | "paused";
      data: undefined;
      error: null;
      refetch(): void;
    }
  | {
      status: "success";
      fetchStatus: "idle" | "fetching" | "paused";
      data: T;
      error: null;
      refetch(): void;
    }
  | {
      status: "error";
      fetchStatus: "idle";
      data: T | undefined;
      error: ApiError;
      refetch(): void;
    };
```

- Refresh keeps the last successful `data`.
- Host generation loss aborts the lifecycle request and sets `fetchStatus: 'paused'`; it is not a remote error.
- An enabled query reads again when the Host generation reconnects.
- `enabled: false` disables automatic reads; `refetch()` still executes one read.
- A caller-provided abort becomes an `ApiError` with `kind: 'aborted'`.
- Structured inputs use a stable JSON fingerprint. Query inputs must be JSON-serializable and acyclic.
- There is no global cache, dedupe, optimistic update, business retry, or persisted query state.

## Errors

`ApiError` is read-only and opaque. Test it with `isApiError(value)`; there is no public constructor.

| `kind`        | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `transport`   | Official transport failed before a valid remote result arrived   |
| `remote`      | Host handler reported a remote failure                           |
| `contract`    | Version, schema, JSON, method, or response contract was violated |
| `aborted`     | The caller's AbortSignal cancelled the call                      |
| `unavailable` | The Host API generation or provider is unavailable               |

Public fields are `name`, `message`, `kind`, `apiId`, `method`, `retryable`, and optional `remoteCode`.

### Host failures the user should read

A handler that throws `new PluginApiError(message, { code })` (from `@dshfiles/dshx/api`) reaches the Client as an `ApiError` with `kind: 'remote'`, that `message` (up to 500 characters) and `remoteCode: code`. Codes match `[a-z][a-z0-9-]*`; a reserved code (`internal`, `contract`, `aborted`, `bad-request`) or a malformed one becomes `plugin`. Write the message for the person using the plugin; never put secrets or raw command output in it.

Any other thrown value stays generic on the Client (`remoteCode: 'internal'`, "API handler failed. See Host diagnostics.") and is logged once on the Host through the `dshx:api` logger with the package, API id and method, the error's name, message and first stack frames, bounded to 2000 characters with common credential shapes redacted. The request input is never logged.

## One registry: other plugins, Clients and the agent

Every API a dshx Host serves joins one process-wide registry. The same contract, handler and schemas then serve three callers:

| Caller | How it calls | Transport |
| --- | --- | --- |
| A browser Client (any plugin) | `useApi(contract)` / `useApiQuery(contract, ...)` | Connection RPC |
| Another Host plugin | `createHostApiClient(ctx, contract, packageId)` | in process, through the owner's dispatch |
| The agent | a native tool, only for methods with `tool` | `ctx.tools` pipeline (policy, guards, approval) |

Set `owner` on a contract that other packages import, and give methods a `description` so they are discoverable:

```ts
export const threadsApi = defineApi({
  id: 'threads',
  version: 1,
  owner: '@dshfiles/jj-integration',
  methods: {
    status: method({
      input: z.object({ path: z.string().min(1).optional() }).strict(),
      output: threadStatusSchema,
      description: 'Revisions of a thread workspace not yet on its target bookmark.',
      tool: { name: 'jj_thread_status', readOnly: true, render: output => summarize(output) },
    }),
  },
})
```

### From another Host plugin

```ts
import { createHostApiClient } from '@dshfiles/dshx/host'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { threadsApi } from '@dshfiles/jj-integration/api'

const threads = createHostApiClient(ctx, threadsApi, '@dshfiles/my-plugin')
const result = await threads.safe.status({ path })
if (!result.ok && isApiOwnerMissing(result.error)) return undefined // jj-integration is not installed
```

The call runs the owner's input schema, handler and output schema, and both sides receive a detached JSON copy, exactly as over Connection. The handler sees `caller: { kind: 'plugin', packageId }`. `isApiServed(ctx, contract)` and `listApis(ctx)` read the registry without calling.

### When the owner is not loaded

A Host call fails with `ApiError { kind: 'unavailable', remoteCode: 'owner-missing' }` without touching the network. A Client call to routes nobody registered gets Connection's HTTP 404, which dshx reports as the same error. Test it with `isApiOwnerMissing(error)` and stop polling or hide the feature; do not match on transport messages.

### Exposing a method to the agent

`tool: { name, description?, readOnly?, render? }` registers a native tool when the Host loads (dshx adds `tools` to `inject`). Requirements and behavior:

- The method needs a `description` (or `tool.description`) and, when it takes input, a schema that publishes Standard JSON Schema (zod 4.2+). The model sees that schema projected onto the DSH tool subset; unsupported keywords are dropped, and the contract schema still validates every call, so the projection only loosens.
- Input must be an object (or absent). The handler gets `caller: { kind: 'agent', sessionId, cwd }`, so a method can default to the calling Session's working directory.
- The call goes through `ctx.tools.execute`: `tools/pre-execute` policies, `ctx.tools.guard` guards and approval apply as to any tool. `readOnly: true` lets it run beside sibling calls; omit it for anything that writes.
- A tool name collision or an unrepresentable schema logs a warning and leaves the method callable by plugins and Clients; it never fails the Host.

Only opted-in methods become tools. Every other method stays callable by Clients and Host plugins.

### Discovery

The first loaded dshx Host with an API also serves `dshxRegistryApi` (owner `@dshfiles/dshx`, exported from `@dshfiles/dshx/api`) and the read-only agent tool `dshx_capabilities`. When that Host unloads, the next one takes over.

```ts
const registry = useApiQuery(dshxRegistryApi, 'list', { input: { schemas: false } })
// registry.data: { apis: [{ owner, id, version, methods: [{ name, description, tool }] }], tools, skills }
```

`tools` lists every tool a top-level agent sees, tagged `api` (with its owner), `mcp` (`mcp__*`) or `tool`; `skills` lists the skill registry for `input.cwd`. This is the data source for a Tools page.

Plugins built with an older dshx do not join the registry until they are rebuilt.

## Automatic Client wiring

If `useApi` or `useApiQuery` survives final tree-shaking, compiler module metadata enables the Client `connection` service. The project must also declare `@deepseek-ai/dsh-client-connection` in `dsh.client.inject`; `dshx check` reports the edge early and `build` is authoritative.
