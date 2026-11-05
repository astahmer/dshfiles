# Secret references

A plugin never stores, receives or renders a credential value. It stores a
reference and resolves it on the Host at the moment it uses the credential. The
Secret Catalog owns the values (through the installed `secret` CLI, a Bitwarden
backend); this page is the contract every consumer follows.

## Shape

```
secret:ALIAS              the alias in the default environment (`prod`)
secret:ALIAS@ENV          the same alias in another environment
```

`secret:ALIAS` is ordinary text, which is the point: a settings string, a backlog
body or an item link can carry it without becoming a secret.

| Piece                         | Owner                       | Where                                                                              |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| Grammar and schemas           | `@dshfiles/credential-port` | `secret-reference.ts`                                                              |
| Host resolver                 | `@dshfiles/credential-port` | `SecretReferenceResolver.resolve({ referenceText, values, environmentValue })`     |
| Value port (CLI access)       | `@dshfiles/secret-catalog`  | `secretCatalogValues.resolve({ reference, cwd })`                                  |
| Reference → control mapping   | `@dshfiles/settings-shell`  | `Schema.string().role('secret-ref')`                                               |
| Vault picker                  | `@dshfiles/secret-catalog`  | `shell.overlay` on `[data-secret-input="reference"]`                               |
| Missing-key setup offer       | `@dshfiles/secret-catalog`  | `@dshfiles/secret-catalog/setup` (`SecretSetupOffer`)                              |
| Why a reference fails         | `@dshfiles/secret-catalog`  | `secret-catalog-setup.referenceStatus`, agent tool `secret_reference_status`       |
| Inline reveal of an item link | `@dshfiles/secret-catalog`  | provides `@dshfiles/backlog/secret-link-reveal`; reveals through its `reveal` verb |

## Consuming a reference on the Host

```ts
import { SecretReferenceResolver } from '@dshfiles/credential-port'
import { SharedJevKey } from '@dshfiles/credential-port/jev-key'

const apiKey = await SecretReferenceResolver.resolve({
  referenceText: SharedJevKey.reference({ shared: shared.jevSecret, legacy: settings.jevSecret }),
  values: ctx.get('secretCatalogValues'),
  environmentValue: process.env.TYPESAFE_API_KEY,
})
```

- An empty setting falls back to the environment variable, so existing setups
  keep working.
- A non-empty setting that is not a reference fails loudly instead of silently
  using the environment.
- A reference with no Catalog loaded fails with a message naming the plugin.
- `@dshfiles/credential-port` resolves to raw TypeScript in `node_modules`, so
  a Host entry that imports it must list it in `host.bundleDependencies`.

`secretCatalogValues` also handles the folder case: pass `cwd` to reach that
folder's project and machine-local aliases; `cwd: null` reads global aliases
only. Unknown aliases and the same alias in two scopes are refused by name,
never guessed.

## Offering the picker in a field

- Settings: declare the setting `Schema.string().role('secret-ref')`. The shell
  renders it with `data-secret-input="reference"`, a masked-looking placeholder
  and Enter/blur commits like any text setting.
- Owned forms: add `data-secret-input="reference"` to a text input (or spread
  `SecretInputBinding.attributes` from the Catalog's client sources if you
  already depend on it). No plugin imports the picker.
- To offer one-click creation (a "Create LINEAR_API_KEY" button beside a field
  with no key), dispatch a bubbling `secret-input:create` event on the marked
  field (`SecretInputBinding.createEvent`). The Catalog opens its
  create-and-bind form for it, prefilled from the field's `data-secret-alias`,
  `data-secret-environment`, `data-secret-scope` and `data-secret-cwd`, and
  writes the stored reference into the field like a pick. Without the Catalog
  the event does nothing, so keep the field usable on its own.
- The picker appears on focus as a key button, lists the global aliases with
  search, and writes the reference through the field's own value setter plus an
  `input` event, so React-controlled state updates. It is portaled into the
  field's own dialog: a modal layer makes everything outside it inert. The
  panel opens below the field, flips above when that side has more room, and
  caps its height to the room left, so it never leaves the viewport.

## Offering masked setup when a required key is missing

A consuming plugin can opt in to a separate setup card or chat-tail offer by
importing `SecretSetupOffer` and its `SecretSetupRequirement` and
`SecretSetupBinding` types from `@dshfiles/secret-catalog/setup`. The consumer
checks availability on its Host, then passes only missing requirement metadata
(id, label, and optional alias/environment/scope/folder suggestions) to the
component in a decorated client slot under the consumer's `PluginQueryProvider`.
The offer preflights non-secret Catalog metadata and stays hidden when the
Catalog is unavailable. Its `onBind` callback receives only `{ id, reference }`;
the form sends the masked value directly to the Secret Catalog Host and stores
no value in the consumer's settings, callback, or chat state. A cancel before
storage writes nothing; if binding fails after storage, only the reference is
retained for retry.

The Backlog uses this opt-in path for Jev when Jev is enabled and its Host-side
resolver cannot produce a key. The chat composer remains ordinary prose; the
suggestion is a separate turn-tail card, not a credential button on free-form
chat text.

## When a configured reference does not resolve

Ask the Catalog why instead of reporting "does not resolve": the
`referenceStatus` verb returns a typed state (alias missing from every scope or
only in a project, environment missing, several scopes, unreadable or empty
value, secret CLI missing, timed out or failing) and whether a global write would
land in a symlinked config. The Catalog's repair card renders it on every
reference field and in Backlog's chat tail, with Set value, Pick another secret,
Open in Secret Catalog and Re-check. A consumer only needs the attribute or the
`secret-ref` role; it never restates the reasons.

## What is deliberately not here

- No plaintext in settings, backlog items or chat. DSH redacts secret values, so
  a field could not round-trip one anyway.
- No vault button on a general capture or chat field. Those hold prose; an item
  stores a `secret:ALIAS` reference typed as ordinary text, while only a field
  whose whole value is a credential carries the attribute.
- No implicit fill on focus: revealing stays an explicit click in the Secret
  Catalog (with its timeout and blur rules).
- No second vault: the `secret` CLI and Bitwarden remain the only store.

## Adopted by

- `@dshfiles/settings-shell` — `jevSecret`, the one TypeSafe Jev key (Settings › Tools & MCP › Jev), read by
  `@dshfiles/backlog` for triage and `@dshfiles/memory` for signal and recall gates. Their earlier per-plugin
  `jevSecret` fields stay stored but hidden: each is the fallback while the shared key is empty, and each plugin copies
  its value into an empty shared key once (`SharedJevKey.adopt` in `@dshfiles/credential-port/jev-key`, written only
  against the revision it read empty, so a set shared key is never overwritten).
- `@dshfiles/mcp-servers` — environment and header bindings of every server
  (global aliases; a DSH credential name still works).
- `@dshfiles/secret-catalog` itself — `request_secret` returns a reference to
  the agent that asked, after the user stored the value in the Catalog form.
