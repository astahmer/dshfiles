# `@dshfiles/credential-port`

The Host service port between a secrets catalog and a credential consumer.

`@dshfiles/secret-catalog` provides it on the Cordis Context as `secretCatalogCredentials`;
`@dshfiles/ai-accounts` reads it to offer and import a key that already lives in the catalog. Both import this
definition, so neither package has to depend on the other's plugin: before it lived here, `ai-accounts` imported the
contract from `secret-catalog`, which closed the dependency cycle
`jj-integration → memory → ai-accounts → secret-catalog → jj-integration` that made `pnpm --filter … run build` and
Turbo fail with a task cycle.

A consumer treats a missing provider as "catalog unavailable" rather than failing the plugin, so the port is optional.

## Runtime distribution

This dependency-only library is not a Cordis bundle. `build` emits ordinary ESM and declarations into `dist/`; the runtime export uses JavaScript while TypeScript consumers retain the source contract. This lets unbundled Host consumers load the package without a TypeScript loader or bundler rewriting its `.js` sibling imports.

`test` builds first, runs the existing schema/resolver tests and checks the public package with ordinary Node. The runtime regression uses synthetic references only; it performs no credential reads or provider calls. The Promise root export and its resolver behavior remain unchanged. Effect APIs are opt-in from `@dshfiles/credential-port/effect`, keeping the existing root import graph—including the Secret Catalog client—free of an Effect runtime import.

## Effect API

The `./effect` subpath provides Effect Schema validators for the existing alias, environment, scope, reference-text, and credential-label grammars, plus a canonicalizing credential-label schema and `SecretReferenceResolver` (`Context.Service`). Its Layer accepts the optional catalog resolver; reference failures and catalog failures have distinct TaggedErrors, while an absent key still uses the caller-supplied environment fallback. The Promise `SecretReferenceResolver` remains exported from the package root.

## Scripts

```sh
pnpm --dir plugins/@dshfiles/credential-port build
pnpm --dir plugins/@dshfiles/credential-port test
pnpm --dir plugins/@dshfiles/credential-port typecheck
```
