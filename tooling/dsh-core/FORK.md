# Narrow DSH core fork

`agent`, `agent-loop`, `session`, `api-session-controller`, and `session-format-catalog` are narrow source snapshots from DeepSeek Harness tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`: https://github.com/deepseek-ai/deepseek-harness. The matching MIT license is retained at `LICENSE`. There is no upstream remote or nested VCS boundary.

The `agent` copy owns Phase 1A's runtime-driver registry while retaining the native package name and default factory. The `agent-loop` copy owns external turn execution through that registry. The `session` copy adds a validated, immutable `runtimeBinding` to Session metadata. The API controller forwards and reports that binding. The format catalog retains its released V0–V4 codecs; `session-format-v4-to-v5` is first-party migration code that keeps the V4 event cut and adds only the runtime selection to the V5 header.

Runtime acceptance remains blocked at the Host module-resolution boundary. The local `session-persistence-jsonl` fork below adapts V5 and links to this fork's catalog, but ordinary DSH CLI boots still lack proof that their in-box imports select the local Agent, Session, catalog, and JSONL package identities. A prior linked-profile boot traced Agent and Session dependencies to the global pnpm store; the profile's `link:` declarations did not change that. `scripts/verify-core-runtime-scratch.mjs` uses an explicit scratch Host entrypoint and therefore proves local runtime behavior, not the ordinary CLI resolver. Phase 1A/1C exit requires that supported loader path to use one consistent local core package set.

These packages are private and are never published by this repository. The focused Session, Agent, and format packages have standalone manifests and locked builds. The API controller still expects upstream root tsconfigs and the shared client build helper; its source is typechecked against the installed DSH 0.2.0-rc.2 declarations, but its host tests require a complete DSH test workspace to execute.

Build the focused packages with Node 22 and pnpm 12 from the repository shell:

```sh
pnpm --dir tooling/dsh-core/session install --frozen-lockfile
pnpm --dir tooling/dsh-core/session run build
pnpm --dir tooling/dsh-core/session run typecheck
pnpm --dir tooling/dsh-core/session run test
pnpm --dir tooling/dsh-core/agent install --frozen-lockfile
pnpm --dir tooling/dsh-core/agent run build
pnpm --dir tooling/dsh-core/agent run typecheck
pnpm --dir tooling/dsh-core/agent run test
pnpm --dir tooling/dsh-core/agent-loop install --frozen-lockfile
pnpm --dir tooling/dsh-core/agent-loop run build
pnpm --dir tooling/dsh-core/agent-loop run typecheck
pnpm --dir tooling/dsh-core/agent-loop run test:runtime
pnpm --dir tooling/dsh-core/session-format-v4-to-v5 install --frozen-lockfile
pnpm --dir tooling/dsh-core/session-format-v4-to-v5 run build
pnpm --dir tooling/dsh-core/session-format-v4-to-v5 run typecheck
pnpm --dir tooling/dsh-core/session-format-catalog install --frozen-lockfile
pnpm --dir tooling/dsh-core/session-format-catalog run build
pnpm --dir tooling/dsh-core/session-format-catalog run typecheck
pnpm --dir tooling/dsh-core/session-format-catalog run test
```

The AgentLoop package exposes only the focused `test:runtime` lane in this snapshot. The Session snapshot omits the upstream-only generator script, so its package test command excludes only `tests/gen-persistence-catalog.spec.ts`; do not describe that as a full upstream suite. Verify package identity through the actual DSH loader; workspace `createRequire` results and profile `link:` declarations do not prove which dependency an in-box importer loads. Never patch the installed global packages or the running web profile. Source and build checks are not activation proof.

`session-persistence-jsonl` is an additional private snapshot from the same release commit, retaining its MIT license. This fork adapts generation scanning, catalog migration, and source-row admission for V5; it links to this fork's catalog so the writer uses the same format as Session and AgentLoop. The profile loader must still prove it resolves the local package and local Session/catalog identities before this counts as runtime acceptance.

`session-persistence` is a private snapshot of the same release commit. It owns `decodeStoredEvents`, which decodes generic format events at the persistence boundary and replaces the JSONL backend's unsafe event-array cast with validated Session values. Its source files were verified against the upstream Git blob ids; the shared MIT license remains at `tooling/dsh-core/LICENSE`.
