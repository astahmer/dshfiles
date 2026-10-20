# Secret input binding

Resume here: decide the open questions below, then phase 1.

## Why

b:78: inputs that need a credential have nowhere safe to keep it. DSH settings
refuse to echo a secret value back (`secret-input-unsupported` in
`tooling/dshx/.../cli/platform.ts`), settings-shell leaves `role('secret')` and
redacted fields out of the form model entirely, and the Backlog triage key is
read from `TYPESAFE_API_KEY` in the Host environment with no UI at all. A plugin
that needs a key therefore either asks for plaintext on every use or documents an
environment variable.

The installed `secret` CLI already owns those values (Bitwarden-backed, see
[Secret Catalog](../../plugins/@dshfiles/secret-catalog/README.md)). What is
missing is the binding layer: a field that stores *which secret* it uses, and a
Host-side resolver that turns that reference into a value only at the moment it
is consumed.

## What

1. **A reference, not a value.** A bound field stores `secret:ALIAS` (or
   `secret:ALIAS@ENV`, environment defaulting to `prod`). The grammar and its
   zod schema live in `@dshfiles/credential-port`, the dependency-free package
   both sides already import, so consumers never restate it.
2. **A Host resolver port.** `credential-port` gains a `secretCatalogValues` port
   (`resolve(reference, cwd)`), implemented by secret-catalog's Host half through
   the same `runSecretCli` path `reveal` uses. Values never cross to a Client
   except through the existing explicit per-row reveal.
3. **A client affordance.** `SecretInput` component (masked or reference text
   input with a key button) plus a `shell.overlay` watcher that decorates any
   element carrying `data-secret-input`. The watcher is what makes the convention
   work for native and third-party inputs we cannot edit; owned forms import the
   component for full UX. Picking an alias writes the reference through the
   native value setter and dispatches `input`, so React-controlled inputs update
   normally.
4. **Backlog first.** A `jevKeyAlias` setting (secret picker) that triage resolves
   on the Host instead of requiring `TYPESAFE_API_KEY`; optional `secret:ALIAS`
   links on items via the existing link extraction, with copy/reveal in the item
   view.

## Why not the alternatives

| Choice                            | Decision | Rationale                                                                                                                        |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Store the plaintext in settings   | No       | DSH redacts it, so the form cannot round-trip it; a second copy also drifts from the vault.                                      |
| Store the plaintext in a backlog item | No       | Rows sync to every browser and the Agent; a reference keeps the item shareable.                                                  |
| Fill the revealed value into inputs | Only on explicit per-field reveal | Same policy as Secret Catalog: reveal is a deliberate click, never an implicit fill on focus.                                    |
| A separate secrets service        | No       | secret-catalog already owns CLI access, scopes and redaction; the new parts are a grammar, a port method and a client affordance. |

## Open questions (blocking phase 2/3)

1. **Scope of “bind”**: reference storage (recommended) vs. item links only vs.
   transient fill.
2. **First consumers**: backlog triage key (recommended) vs. generic mechanism
   only vs. backlog item links only.
3. **`data-secret-input` reach**: overlay for any marked input plus the exported
   component (recommended) vs. explicit component adoption only.

## Phases

| Phase | Work                                                                                                                       | Proof                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1     | Grammar + schemas + `resolve` port method; unit tests in `credential-port` and secret-catalog                               | `pnpm --dir plugins/@dshfiles/credential-port test` |
| 2     | `SecretInput` component and the `[data-secret-input]` overlay (positioning, controlled-input writes, Esc, busy state)        | Vitest for the write helper; e2e journey on a marked field |
| 3     | Backlog: `jevKeyAlias` setting, Host-side resolution in triage, fallback to `TYPESAFE_API_KEY` when unset                    | triage test with a stubbed resolver + e2e settings journey |
| 4     | Backlog item `secret` links (extraction, display, copy/reveal), if question 2 keeps item links                              | link extraction test + item-view e2e                 |

## Limits

- One alias per field; a field that needs several goes through a dedicated form.
- The overlay decorates text-like inputs only (`input`/`textarea`); it never
  observes or stores values, and it stops watching when the slot disposes.
- Values remain Host-only; the browser stores `secret:ALIAS` and nothing else.
- Resolution failures surface as the consuming feature's own error, naming the
  alias but never the value.

## Verification

```sh
pnpm --dir plugins/@dshfiles/credential-port test
pnpm --dir plugins/@dshfiles/secret-catalog test
pnpm --dir plugins/@dshfiles/backlog test
pnpm run check:e2e secret-catalog   # reveal/copy journeys still pass
pnpm run check:e2e backlog          # secret-bound setting journey
```
