# `@dshfiles/jev`

The Effect service that asks TypeSafe's Jev (`POST https://api.typesafe.ai/v1/systemone`) one Noul question. It
replaces the Promise clients memory and backlog each kept: one endpoint, one request and answer schema, one
`jev classify` client span, and one usage record per call in `@dshfiles/usage`'s Jev ledger.

It is a library package, not a Cordis bundle and not a dshx module: a Host entry lists it in
`host.bundleDependencies`. It depends only on dshx and the `@dshfiles/usage/api` contract, which both callers already
import.

## API

```ts
import { Jev, JevVerdict, type JevRequest } from '@dshfiles/jev'

Jev.layer: Layer<Jev, never, HttpClient | HostApis>

jev.ask({ question, text, credential, source, timeout }): Effect<JevVerdict, JevError>
```

- `question` is `{ name, instructions, criteria: { true, false } }`; `name` goes on the span as `jev.question`.
- `credential` is `{ apiKey: Redacted<string>, label }`; the label is the safe local name the usage ledger groups by.
- `source` is the calling plugin (`memory` or `backlog`), recorded with the call and on `dshx.plugin.package`.
- Every call, success or failure, records one `recordJevUsage` row with timing and provider-reported tokens. A missing
  or failing usage plugin never fails the call.

Errors: `JevTransportFailed` (with `cause`), `JevTimedOut` (`timeoutMs`), `JevStatusRejected` (`status`),
`JevAnswerInvalid` (with `cause`). None is exposed on the wire; callers decide what an unknown verdict means.

Provide `FetchHttpClient.layer` from `effect/http` and `HostApis.layer` from `@dshfiles/dshx/effect/host-apis`.

## Scripts

```sh
pnpm --dir plugins/@dshfiles/jev build
pnpm --dir plugins/@dshfiles/jev test
pnpm --dir plugins/@dshfiles/jev typecheck
```
