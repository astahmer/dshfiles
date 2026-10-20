# @dshfiles/model-effort-picker

![Edit the model fallback chain from the composer picker](docs/screenshots/model-fallbacks.png)

Replaces the composer model control with a searchable, provider-grouped model picker. Its reasoning slider uses only the selected model’s advertised effort levels and writes through DSH’s shared per-session model directory, so the native model popup stays in sync.

## Account swap

When another provider route offers the selected model — a second Codex or Claude account from AI Accounts, say — a swap button sits beside the picker. One click moves the Session to the next such route in catalog order, keeping the reasoning effort when the target advertises it. Settings › Model effort picker turns it off (`accountSwap`) or limits the rotation to a list of route ids (`accountSwapRoutes`; empty means every route that offers the model).

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The plugin owns the composer model slot; model catalogs, selection projection, availability checks, and writes remain owned by DSH’s `modelDirectories` service.
