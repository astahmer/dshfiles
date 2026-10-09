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

Each handler receives `{ input, ctx, signal }`. `.host()` requires exactly the contract's method keys: missing and extra handlers are type errors and are also rejected at runtime. `authority` defaults to `loopback`; pass `{ authority: 'trusted-host' }` only when the official Connection policy requires it.

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

## Automatic Client wiring

If `useApi` or `useApiQuery` survives final tree-shaking, compiler module metadata enables the Client `connection` service. The project must also declare `@deepseek-ai/dsh-client-connection` in `dsh.client.inject`; `dshx check` reports the edge early and `build` is authoritative.
