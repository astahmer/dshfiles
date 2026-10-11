# @dshfiles/model-effort-picker

Replaces the composer model control with a searchable, provider-grouped model picker. Its reasoning slider uses only the selected model’s advertised effort levels and writes through DSH’s shared per-session model directory, so the native model popup stays in sync.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The plugin owns the composer model slot; model catalogs, selection projection, availability checks, and writes remain owned by DSH’s `modelDirectories` service.
