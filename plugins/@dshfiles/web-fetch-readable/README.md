# @dshfiles/web-fetch-readable

A `web_fetch` backend for `ctx.web` that follows redirects across origins,
decodes more text formats and returns the readable article of an HTML page.
Select it through the profile's `web` row (`fetchProvider: readable`).

It is a port of DSH's own `@deepseek-ai/dsh-web-fetch-http@0.2.1-rc.2` (MIT),
which stays the reference for the address checks. The self-improve mining pass
found most `web_fetch` failures in that provider's policy rather than in the
pages (plans/self-improve, T6): it refuses every cross-origin redirect with
`WEB_REDIRECT_BLOCKED` (`http→https`, `www.`, moved docs hosts) and every body
that is not `text/*`, HTML, JSON or XML. Computer use was rejected for the same
problem: a browser costs 25–50× the latency per page.

## What changes from the stock provider

| Behaviour            | Stock `http`                    | `readable`                                                                                         |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Redirects            | Same origin only, 5 hops        | Any origin, 8 hops (setting); every hop revalidated                                                |
| Accepted bodies      | HTML, `text/*`, JSON, XML       | Also JavaScript, YAML, TOML, shell, SQL, NDJSON, Markdown; untyped/`octet-stream` sniffed as UTF-8 |
| HTML                 | Whole page                      | Mozilla Readability article (title, byline, content); whole page when no article is found          |
| Unsupported type     | `WEB_UNSUPPORTED_CONTENT_TYPE`  | Same code, with "download binary files with bash (curl -o)"                                        |
| Address checks/proxy | Public addresses, pinned; proxy | Unchanged (ported)                                                                                 |

**Redirect safety.** Each hop goes through the URL policy (HTTP(S) only, no
embedded credentials, 2 048 characters), then one DNS resolution whose whole
answer set must be public unicast (IPv4-mapped and NAT64-translated addresses
included), then a connection pinned to that set. A redirect therefore cannot
reach a loopback, private or link-local address the first URL could not, and a
redirect to an IP literal is refused even when a proxy is configured.

## Set it up

1. Install the bundle into the intended profile:

   ```sh
   pnpm profile:sync --profile <name> --bundle @dshfiles/web-fetch-readable
   ```

2. Point the profile's `web` row at it (`fetchProvider: readable`). With two
   registered fetch providers and no setting, DSH refuses with
   `WEB_PROVIDER_AMBIGUOUS`.
3. Restart DSH when you choose; the provider registers at activation.

## Settings

Host settings in the `dshfiles-web-fetch-readable` namespace (no client form yet;
write them with `settings_set`). Every value is read per fetch, so a change applies to the next call.

| Field              | Default   | Meaning                                                    |
| ------------------ | --------- | ---------------------------------------------------------- |
| `readable`         | on        | Reduce HTML to its article; off returns the whole page     |
| `maxRedirects`     | `8`       | Hops to follow, 0–20                                       |
| `timeoutMs`        | `30000`   | Whole-fetch timeout, redirects included                    |
| `maxResponseBytes` | `5000000` | Bytes read; a larger declared length is refused            |
| `maxBodyChars`     | `100000`  | Characters returned after extraction; the tool caps on top |

## Telemetry

One `web fetch` client span per call with the status, body kind, truncation,
redirect and cross-origin redirect counts and the extraction outcome
(`article`, `disabled`, `no-article`, `too-large`, `failed`, `not-html`). The
URL and the body are never recorded.

## Verification

`node --run test` drives the provider over a fake network that runs the real
address validation: a cross-origin redirect resolved and pinned per hop, a
redirect to a private, loopback, `file:` or credentialed URL refused, the hop
cap, the widened types, binary refusal, article extraction and the span. A live
fetch needs the bundle selected in a profile; the E2E journey
(`web-fetch-readable.feature`) proves activation only, because scratch Hosts
have no external network (see the Host egress guard in docs/e2e-testing.md).

## Provenance

`src/network.ts`, `src/policy.ts` and `src/provider.ts` are ported from
`@deepseek-ai/dsh-web-fetch-http@0.2.1-rc.2` (MIT, deepseek-ai/deepseek-harness,
`packages/web/web-fetch-http`). Update policy: when a DSH release changes that
package's address checks, port the change here and re-run the tests.
