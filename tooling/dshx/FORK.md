# Our DSHX source fork

This is a complete source hardfork of
[liyown/dshx](https://github.com/liyown/dshx). It lives at `tooling/dshx` inside
this repository's single Jujutsu/Git boundary — there is no nested repo and no
upstream remote. We edit the TypeScript, React, compiler, CLI, templates,
tests, and documentation directly. There is no patch application step and no
dependency on an upstream DSHX installation.

DSH and Cordis remain the native runtime. Original MIT licensing and attribution
remain in this tree.

## Independent maintenance

There is no upstream remote or bookmark and no fetch or merge workflow. This
fork is maintained from this source tree against the installed DSH and Cordis
contracts. The upstream link above records code provenance only; original MIT
licensing and attribution remain in this tree.

Source baseline: `8048a780a263cbd788b71d316f2ec84a272158f8`.
Initial protocol-2 integration: `c9ea7e6eef5b04aef2360d60102309cbde53d36b`.
Verified SDK foundation: `8442b487f4bc3f6aae78e0abd2a6d5ce29f0501c`.

```sh
cd tooling/dshx
fnm exec --using 22.23.3 pnpm install --frozen-lockfile
fnm exec --using 22.23.3 pnpm --filter create-dshx build
fnm exec --using 22.23.3 pnpm --filter @dshfiles/dshx build
fnm exec --using 22.23.3 pnpm --filter @dshfiles/dshx test --maxWorkers=1
```

The package is owned here as `@dshfiles/dshx`. The plugin workspace at
`plugins/@dshfiles/ai-accounts` links it by local path, so the CLI a plugin
builds with is always the code in this tree — never a registry download.

## Native development dependencies

The workspace contains archived protocol-1 fixtures as well as the protocol-2
SDK. Root pnpm overrides keep Cordis, Include, and Loader on one type identity.
Package extensions attach protocol-2 slot declarations to the native packages
that import them in public types but list them only as development dependencies.
Without those edges, pnpm can resolve a protocol-1 hoisted slot package from a
protocol-2 declaration. These are workspace dependency-resolution settings;
they do not replace native services or modify DSH source.
