# `@dshfiles/credential-port`

The Host service port between a secrets catalog and a credential consumer.

`@dshfiles/secret-catalog` provides it on the Cordis Context as `secretCatalogCredentials`;
`@dshfiles/ai-accounts` reads it to offer and import a key that already lives in the catalog. Both import this
definition, so neither package has to depend on the other's plugin: before it lived here, `ai-accounts` imported the
contract from `secret-catalog`, which closed the dependency cycle
`jj-integration → memory → ai-accounts → secret-catalog → jj-integration` that made `pnpm --filter … run build` and
Turbo fail with a task cycle.

A consumer treats a missing provider as "catalog unavailable" rather than failing the plugin, so the port is optional.

## Scripts

```sh
pnpm --dir plugins/@dshfiles/credential-port test
pnpm --dir plugins/@dshfiles/credential-port typecheck
```
