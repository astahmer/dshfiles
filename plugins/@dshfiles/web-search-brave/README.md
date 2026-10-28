# @dshfiles/web-search-brave

A Brave Web Search backend for `ctx.web`. Select it through the profile's `web`
row (`searchProvider: brave`). Credentials are not stored in shared source: the
setting holds an optional Secret Catalog reference, resolved by the Host per
search, or uses `BRAVE_API_KEY` from the Host environment.

## Set it up

1. Create a key in the [Brave dashboard](https://api-dashboard.search.brave.com/app/keys).
2. Choose your own alias in the Secret Catalog and store the value in an
   appropriate local/global scope. No alias is preselected by the shared default.
3. In **Settings → Plugins → Web search (Brave)**, select that alias in the
   **API key reference** field (`secret:ALIAS` or `secret:ALIAS@env`). Alternatively,
   leave the field empty and configure `BRAVE_API_KEY` in the Host environment.
   Never commit a resolved value or personal alias mapping.
4. Install the selected bundle into the intended profile, preserving unrelated
   bundle selection. For an existing custom profile, use a scoped sync rather
   than selecting every owned plugin:

   ```sh
   pnpm profile:sync --profile <name> --bundle @dshfiles/web-search-brave
   ```

   The `web` row must carry `searchProvider: brave`; otherwise the base
   composition can use its own provider and credential requirements. Do not
   assume anything about the current machine's installed credentials.

5. Let the user choose any required Host restart. Existing saved references stay
   local; changing shared defaults does not clear them.

## Settings

| Field        | Default    | Meaning                                                              |
| ------------ | ---------- | -------------------------------------------------------------------- |
| `apiKey`     | empty      | Optional user-selected secret reference; empty uses `BRAVE_API_KEY`  |
| `count`      | `5`        | Results requested per search, 1–20; the tool still bounds the result |
| `safesearch` | `moderate` | Brave safesearch level: `off`, `moderate`, `strict`                  |

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
`fetch`. Live search needs an explicitly configured credential and an activated
bundle; verify with an authorized real query through `web_search` and inspect its
sources. Unit fixtures are not proof of current provider acceptance.
