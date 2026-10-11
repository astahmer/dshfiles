# Model Effort Picker — Integration Closeout

## Decision and preservation

- **Winner:** the `model-effort-picker-fixed` implementation. Its provider/model catalog, search, selection, and reasoning-effort logic is already present on the current shared line; the line adds the DSHX `models` capability, feature metadata, E2E journey, and stricter tests.
- `model-effort-picker` and `model-effort-picker-main` had identical plugin trees (`jj diff` reported zero files changed). Both were older scaffold variants: their placeholder Host command and scaffold docs are superseded by the fixed implementation.
- The fixed source snapshot (`6653aa7eb55e30b4d513554e9ccbb986ccb4fb1f`) was compared with the integrated picker. Its model-list behavior is present on the line; remaining differences were formatting/configuration, the unused `Plugin.module.css`, and test refinements. The CSS file is not imported by the plugin.
- At the earlier integration check, commit `21a0ef81b65509553638a0f375dbc764df7bc7a9` and clean line parent `962dedf132039617940c3683f806a2975244e1c0` had no diff in picker, E2E, or capability files other than a trailing comma in `runtime-capabilities.ts`. The follow-up DSHX, picker, and E2E revisions below are now represented in the current default tree; comparison against the verified revisions showed no DSHX/E2E changes and only later lockfile churn for the plugin.
- Before cleanup, all four picker workspaces were moved to empty working-copy commits over the same current line commit, and each passed `jj status` clean plus `jj diff --from @ --to a265877111cdcf2e886421a67d666082ec62209a --stat` with zero changed files. The `model-effort-picker-fixed` workspace remains; the `model-effort-picker`, `model-effort-picker-main`, and `model-effort-picker-integration` workspace registrations were forgotten. Their source revisions remain available in shared history.

### Source revisions

| Snapshot                         | Commit                                     |
| -------------------------------- | ------------------------------------------ |
| Older `model-effort-picker`      | `e3439debe80ed366193fc1d7f7e8a58a959cedfc` |
| Older `model-effort-picker-main` | `00a0092805625c2df61e6cdbaee1478b34660842` |
| Selected fixed source            | `6653aa7eb55e30b4d513554e9ccbb986ccb4fb1f` |
| DSHX model capability            | `8015dbbd0a89777e832deb042fdac82900b79b4f` |
| Picker + E2E integration         | `21a0ef81b65509553638a0f375dbc764df7bc7a9` |
| Formatting follow-up             | `72e902c26c7a749bc1b7ec7dad1b6f4df29ebf24` |
| DSHX model dependency fix        | `8663393bcb1e8fad5e7f1e7fca0256b288d79232` |
| Picker runtime and peer fix      | `992ae5df38baced343caba4ead66b03f7b2b95db` |
| E2E Session and slider journey   | `6b17abb9a0d1c71aab9786810381573d31f753c3` |
| Web profile seed promotion       | `333880ce44d11c52b46f235c36fd12438aaac1af` |

The three unregistered workspace directories remain on disk at the canonical line tree. Old source snapshots remain recoverable by the commit IDs above. No unrelated workspaces or commits were abandoned.

## Marketplace recheck (2026-10-16)

- dsh-market has partial matches: [`dsh-reasoning-effort`](https://dshmarket.com/p/Mu-scorpio/dsh-reasoning-effort/) documents provider grouping and a composer slider, but not search; [`dsh-model-picker`](https://dshmarket.com/p/ZZJQ678/dsh-model-picker/) documents search/grouping and per-model effort, but says DSH Web is untested; [`genius-alray/dsh-model-picker`](https://dshmarket.com/p/genius-alray/dsh-model-picker/) has fuzzy search/grouping and a level dropdown, not an inline slider, and its README says it is unmaintained after DSH 0.2 added native search.
- An exact community match exists outside dsh-market: [`@bittersmilezzz/dsh-model-selector` v0.3.8](https://dsh.pub/en/plugins/dsh-model-selector/), pinned at [`5cb5108`](https://github.com/bitterSmilezzz/dsh-model-selector/tree/5cb5108ceb89c36f4554ac290cd98ddf328352d4). Its peer ranges include DSH 0.2.0-rc.2 and its source uses the official `ModelDirectory`/model-selection client contract; it has search, provider groups, and an inline effort slider. It also auto-selects the strongest effort on some model switches. The user chose to keep the DSH-owned `-fixed` implementation, so no third-party bundle was adopted or ported.

## Progress

| Milestone                                            | Status   |
| ---------------------------------------------------- | -------- |
| Marketplace comparison and DSH-owned decision        | complete |
| DSHX model capability dependencies                   | complete |
| Picker implementation and package peers              | complete |
| Disposable browser journey                           | complete |
| Described source revisions and consolidation handoff | complete |
| Web profile seed and installed profile promotion     | complete |

## Validation and remaining gates

| Gate            | Evidence                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin          | `typecheck`, `test` (2 files/4 tests), `build` (6 artifacts), and Node host-import check pass.                                                                                                                                                                                                                                                             |
| DSHX capability | Build passes; focused `sdk-client.spec.ts` passes 6 tests. Its regression assertion verifies `uses: ['models']` injects `modelDirectories`, `sessions`, `remote`, and `remote.session`.                                                                                                                                                                    |
| Browser         | Targeted Playwright journey passes in a disposable `bootPluginProfile` scratch profile. It creates a real Session, confirms the expected `MISSING_CREDENTIAL` response, mounts the picker without a Slot error boundary, browses the provider-grouped model list, preserves selection on an empty search, and changes reasoning effort through the slider. |
| Feature catalog | `features:check` reports 83 unrelated baseline issues; no picker issue is reported.                                                                                                                                                                                                                                                                        |
| Web profile     | Seed updated and bundle synced via `pnpm profile:sync --profile web --bundle @dshfiles/model-effort-picker`; `dsh --profile web --dump-config` includes `dshfiles-model-effort-picker`. The running server was not restarted, so live activation is pending the user's restart.                                                                            |

- Runtime causes verified against installed 0.2.0-rc.2 packages: DSHX `models` omitted dependencies declared by `ModelDirectoryResolver` (`sessions`, `remote`, `remote.session`), and the native `conversation.input.model` single slot requires a distinct priority. DSHX now maps the service/provider dependencies; picker priority `-1` shadows the default priority `0` (the lowest priority renders).
- Plugin peers now cover the Host artifact's `@deepseek-ai/dsh-tools` and the model capability's `@deepseek-ai/dsh-api-gateway` / `@deepseek-ai/dsh-api-session-controller` providers.
- A temporary symlink to the official session-controller 0.2.0-rc.2 prebuilt `lib` enabled local validation while matching in-tree output was unavailable. It was removed after confirming the exact target. A future local rebuild needs matching generated output from the source package or that official package artifact.
- The default checkout now carries the verified DSHX and E2E content; comparison with the verified picker revision showed only subsequent plugin lockfile changes. The profile sync linked the installed bundle to the default checkout, not the temporary verification workspace.

## Recovery

The source revisions above remain in the shared JJ store. To inspect the selected source again, create a linked workspace at a new, unused path:

```sh
jj workspace add /Users/astahmer/dev/dshfiles-model-effort-picker-recovery \
  --name model-effort-picker-recovery \
  -r 6653aa7eb55e30b4d513554e9ccbb986ccb4fb1f
```

## Resume here

The web profile is synced and its composed config contains the picker row. The existing web server still needs a user-controlled restart before the new bundle is loaded; do not restart it from this workspace.
