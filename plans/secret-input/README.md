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
missing is the binding layer: a field that stores _which secret_ it uses, and a
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

| Choice                                | Decision                          | Rationale                                                                                                                         |
| ------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Store the plaintext in settings       | No                                | DSH redacts it, so the form cannot round-trip it; a second copy also drifts from the vault.                                       |
| Store the plaintext in a backlog item | No                                | Rows sync to every browser and the Agent; a reference keeps the item shareable.                                                   |
| Fill the revealed value into inputs   | Only on explicit per-field reveal | Same policy as Secret Catalog: reveal is a deliberate click, never an implicit fill on focus.                                     |
| A separate secrets service            | No                                | secret-catalog already owns CLI access, scopes and redaction; the new parts are a grammar, a port method and a client affordance. |

## Decisions

Settled with the user (2026-10-20):

1. **Bind means a reference.** A field stores `secret:ALIAS[@env]`; the Host
   resolves it when it consumes the credential. No plaintext in settings, items
   or browser state.
2. **Backlog first, generic mechanism underneath.** The Jev triage key binds to
   an alias, and `data-secret-input` stays a generic contract any field can opt
   into. A general capture composer does not: it holds prose, so the vault offer
   sits on top of the text there and was removed.
3. **Attribute first, overlay ships it.** `data-secret-input="reference"` is the
   contract; the Secret Catalog registers the `shell.overlay` picker, so native
   and third-party fields get it without importing anything.

## Phases

| Phase | Work                                                                                                              | State                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1     | Grammar, `secretReferenceSchema`, and the `secretCatalogValues` port in `credential-port`                         | Shipped                                                                                          |
| 2     | `createSecretCatalogValues` in the Catalog: one unique row per alias+environment, revealed through the CLI        | Shipped                                                                                          |
| 3     | `role('secret-ref')` control in settings-shell, rendered with `data-secret-input`                                 | Shipped                                                                                          |
| 4     | `SecretInputBinding` + the `shell.overlay` picker: key button on a focused field, alias search, controlled writes | Shipped; portaled into the field's dialog because a modal layer makes the rest of the page inert |
| 5     | Backlog: `jevSecret` setting, `BacklogTriageKey` resolution, environment fallback, `secret` link extraction       | Shipped                                                                                          |

Verified end to end in a scratch DSH with the fake secret CLI: Settings → "jev secret" → key
button → `GITHUB_TOKEN@prod` → the field holds `secret:GITHUB_TOKEN`. Modals needed two fixes the
unit tests cannot catch: the affordance was portaled below the dialog (so its clicks were inert), and
the alias panel closes on pick only when it is unmounted rather than `hidden` (a `dshflex` class beats
the `hidden` attribute). The panel now places itself from its measured content height: it flips above a
field near the bottom, caps its height to the room left and scrolls, and keeps the key button on screen;
`secret-input-placement.test.ts` pins those three cases.

Still open: reveal a bound reference inline from an item's `secret` link (the
Catalog row's own reveal covers it today), and adopting the attribute on
MCP server env fields and AI Accounts refs where a value is currently typed.

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
