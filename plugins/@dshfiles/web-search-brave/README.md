# @dshfiles/web-search-brave

A Brave Web Search backend for `ctx.web`, selected by the `web` row in the
profile seed (`searchProvider: brave`). The key is **never** stored here: the
setting holds a Secret Catalog reference and the Host resolves it per search, so
a rotated key reaches the next call without a restart.

## Set it up

1. Create a key in the Brave dashboard (`Data for AI` → API keys), free tier.
2. Store it, prompting hidden, in the global scope so every thread and project
   sees the same alias:

   ```sh
   secret set brave-api-key --global --source https://api-dashboard.search.brave.com/app/keys
   secret print global | grep brave-api-key   # alias exists, no value printed
   ```

3. The setting defaults to `secret:brave-api-key`, so nothing else is needed. To
   bind a different alias, open **Settings → Plugins → Web search (Brave)** and use
   the key picker on the _API key reference_ field (it lists the global aliases).
   An empty field falls back to `BRAVE_API_KEY` from the Host environment.
4. Install the bundle in the profile and let the Host restart load it:

   ```sh
   pnpm profile:sync --profile web   # adds the dependency and the patch row
   ```

   The `web` row must carry `searchProvider: brave`; without it the base
   composition keeps `deepseek-official`, which needs a `DEEPSEEK_API_KEY` that this
   machine does not have.

## Settings

| Field        | Default                | Meaning                                                                |
| ------------ | ---------------------- | ---------------------------------------------------------------------- |
| `apiKey`     | `secret:brave-api-key` | Secret reference (`secret:ALIAS` or `secret:ALIAS@env`); never a value |
| `count`      | `5`                    | Results requested per search, 1–20; the tool still bounds the result   |
| `safesearch` | `moderate`             | Brave safesearch level: `off`, `moderate`, `strict`                    |

## Behaviour

- One `GET https://api.search.brave.com/res/v1/web/search` per search, 15 s
  timeout, caller cancellation honoured.
- `title`/`description` are stripped of Brave's `<strong>` highlighting and HTML
  entities; results are deduplicated by URL; `page_age`/`age` becomes
  `publishedAt`.
- Failures are `WebError`s the seam already knows: `WEB_PROVIDER_CREDENTIAL_MISSING`
  (no resolvable key), `WEB_PROVIDER_ERROR` (HTTP status, invalid JSON,
  unexpected shape, no results) and `WEB_ABORTED` (caller cancelled). A 401/403
  message says the key was rejected; a 429 says Brave rate-limited.

## Verification

`node --run test` covers mapping, markup stripping, dedupe, an unexpected
payload, a rejected key, an empty result set and caller abort with an injected
`fetch`. Live search needs the key and a restarted Host; verify with a real query
through `web_search` and check the sources come from Brave.
