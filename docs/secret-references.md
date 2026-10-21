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

| Piece                       | Owner                       | Where                                                                          |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| Grammar and schemas         | `@dshfiles/credential-port` | `secret-reference.ts`                                                          |
| Host resolver               | `@dshfiles/credential-port` | `SecretReferenceResolver.resolve({ referenceText, values, environmentValue })` |
| Value port (CLI access)     | `@dshfiles/secret-catalog`  | `secretCatalogValues.resolve({ reference, cwd })`                              |
| Reference → control mapping | `@dshfiles/settings-shell`  | `Schema.string().role('secret-ref')`                                           |
| Vault picker                | `@dshfiles/secret-catalog`  | `shell.overlay` on `[data-secret-input="reference"]`                           |

## Consuming a reference on the Host

```ts
import { SecretReferenceResolver } from '@dshfiles/credential-port'

const apiKey = await SecretReferenceResolver.resolve({
  referenceText: settings.jevSecret,
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
- The picker appears on focus as a key button, lists the global aliases with
  search, and writes the reference through the field's own value setter plus an
  `input` event, so React-controlled state updates. It is portaled into the
  field's own dialog: a modal layer makes everything outside it inert. The
  panel opens below the field, flips above when that side has more room, and
  caps its height to the room left, so it never leaves the viewport.

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

- `@dshfiles/backlog` — `jevSecret`, the TypeSafe key for triage.
- `@dshfiles/memory` — `jevSecret`, the TypeSafe key for signal and recall gates.
