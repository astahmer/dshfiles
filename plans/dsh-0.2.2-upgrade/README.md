# DSH core 0.2.1-rc.2 → 0.2.2-rc.1

Backlog: b:2vw5. Target is `0.2.2-rc.1`: `0.2.2-rc.2` has a GitHub release
(2026-11-11) but no npm package, so it cannot be installed or pinned yet.

Resume here: see the first row that is not `done`.

| # | Step                                                                                         | State   |
| - | -------------------------------------------------------------------------------------------- | ------- |
| 1 | Pins: catalog, manifests, overrides, packageExtensions, release-age excludes, `.node-version` | done    |
| 2 | `pnpm install` on Node 24.11.1                                                                | done    |
| 3 | dshx: compat record, Node range, verified versions, docs                                      | done (verified list waits on boot) |
| 4 | Port the 27 native forks to `dsh-v0.2.2-rc.1` (`native-fork-diff.mjs <fork> --to …`)         | done    |
| 5 | Owned plugins: API migrations surfaced by typecheck                                           | done (ai-accounts failover redesigned; gap in dsh-host-gaps.md) |
| 6 | Seed profile: re-sync `preset-standard` with the 0.2.2 standard preset                        | done (check tool-subagent fork config names) |
| 7 | Verify: typecheck, focused tests, probe boot, boot-check-web                                  | build 122/122, typecheck 246/246, scratch web seed 101/101 active; per-plugin boot running |
| 8 | Land, rebuild canonical checkout, `dsh-lkg upgrade 0.2.2-rc.1` (user-authorized)              | pending |

## Breaking changes between 0.2.1-rc.2 and 0.2.2-rc.1

Read from every release in between: 0.2.1-rc.3, rc.4, rc.5, 0.2.2-alpha.2,
alpha.3, rc.1.

1. Node `>=24.9.0` (`engines.node` of `@deepseek-ai/dsh`). The Host refuses
   Node 22; `.node-version` moves to 24.11.1.
2. Cordis Core 4.1.0, Loader 1.1.0, Include 1.1.0, Timer 1.2.0, schemastery
   3.19.0. Cordis Timer changed its return values (alpha.2).
3. Tools activate per step: plugins migrate `tools.resolve` / `executable` and
   prompt-assembly integration (alpha.2).
4. Native and PTC tool execution split into Agent-scoped plugins; `tools.mode`
   and `DSH_TOOLS_MODE` are replaced by configuration overlays.
5. Session Projection registration is asynchronous with a retained handle;
   legacy disposers and key reads still work with deprecation notices.
6. The step model is captured before prompt assembly; select through
   `agent.model`, `agent/request` may no longer change the route.
7. Official bundle lists moved from `@deepseek-ai/dsh-app-boot` to
   `@deepseek-ai/dsh-official-bundles`.
8. `@deepseek-ai/dsh-experimental-tool-worktree` merged into Change requests and
   worktrees; remove it from `dsh.profile.bundles` where enabled.
9. Read-before-write and external-change checks are off by default; a profile
   restores them with the observation policy.
10. Custom plugin markets renamed to custom plugin indexes.
11. PTC `run_code` cancellation reports `ABORTED`; PTC SSH protocol 2 → 3.
12. Undeclared custom-model capacities default to 1M context / 128K output.
13. Web Fetch no longer refuses non-public addresses.
14. `@deepseek-ai/dsh-tool-subagent-control/list-agents` is gone: a preset row
    naming it fails to load. Subagent `modelSelectionSettings` became
    `modelSelection` + `modelDiscovery`. `tool-fs` gained `applyPatch`.
15. `dsh-client-ui-deepseek-model-label-1017` row removed; new stock client
    rows: `ui-file-actions`, `ui-context-menu`, `message-quotes`,
    `ui-file-drag`, `deliverable-file-references`, `entry-customization`.
16. PTC preset: `tool-presentation` (mode ptc) replaced by
    `@deepseek-ai/dsh-tool-executor-ptc`.

## Restart prerequisites (user)

1. The live supervisor runs `fnm exec --using=v22.23.3` (nixfiles
   `dsh-web-supervisor.mjs`): move it to Node >= 24.9 in nixfiles, `nixapply`.
2. Live profile `~/.dsh/profiles/web/cordis.patch.yml`, row `preset-standard`
   (outside the managed region): apply the same edits as the seed.
3. `dsh-lkg` picks the candidate's Node from `process.execPath`: run it with
   Node 24 (`fnm exec --using=24.11.1 node scripts/dsh-lkg/cli.mjs …`).
