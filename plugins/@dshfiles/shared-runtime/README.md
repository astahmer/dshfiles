# @dshfiles/shared-runtime

One copy of the UI stack for every owned Client plugin, loaded once through the DSH module table.

Without it each plugin inlines its own radix, tanstack, motion, zod and `@xstate/react` code: bundle bytes grow
with the plugin count, and the copies disagree — two `QueryClient` modules, two zod registries, radix portals that
do not know about each other. Measured on this repository before the rollout: the nine plugins that shipped their
own copies were ~1.3 MB heavier in total, and `pulls-review` alone carried 356 KB of libraries the page already
loads.

## Consuming it

```ts
// dshx.config.ts
export default defineConfig({
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime' },
})
```

```json
// package.json — the Host must install the supplier, so it belongs in dependencies
"dependencies": { "@dshfiles/shared-runtime": "workspace:*" },
"dsh": { "client": { "external": ["@dshfiles/shared-runtime"] } }
```

Then rebuild. An import whose specifier exactly matches a provided module resolves to a facade over the supplier's
copy; a subpath of a provided package would bundle a second copy, so provide the subpath here instead. A module the
plugin needs as its own (mutable per-plugin state) belongs in `client.bundleDependencies` with a comment saying why.

## Providing

`dshx.config.ts` → `client.sharedRuntime.provide` lists the exact specifiers. Add one when two or more Client
plugins retain the same library; check a built bundle with `dist/client.js.deps.json`, which names every retained
source file.

Keep the list to packages with **module-level state or real weight**. A library that tree-shakes to a few hundred
bytes (an icon set, a tiny helper) is cheaper left private.

## The check

`node plugins/scripts/check-shared-runtime.mjs` (wired as `pnpm check:shared-runtime` in `check:green`) reads each
built Client bundle's dependency manifest and fails when a plugin retains a package this supplier provides without
declaring `shared`, or without listing it in `client.bundleDependencies` as a deliberate private copy. It runs after
the plugin build, so it judges artifacts rather than config claims.

## What is shared today

The supplier provides `@deepseek-ai/schemastery`, the radix primitives plugin-ui renders, `@tanstack/*`, `xstate`,
`@xstate/react`, `sonner`-style helpers, `clsx`, `tailwind-merge`, `class-variance-authority`, `cmdk`, `motion`,
`aria-hidden`, `react-remove-scroll`, `zod` and `zod/mini`. React, React DOM and the `@deepseek-ai/*` runtime come
from the page itself (see `tooling/dshx/docs/guides/build.md`), so they are never listed here.
