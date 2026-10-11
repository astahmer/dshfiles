# Model Effort Picker — Integration Closeout

## Decision and preservation

- **Winner:** the `model-effort-picker-fixed` implementation. Its provider/model catalog, search, selection, and reasoning-effort logic is already present on the current shared line; the line adds the DSHX `models` capability, feature metadata, E2E journey, and stricter tests.
- `model-effort-picker` and `model-effort-picker-main` had identical plugin trees (`jj diff` reported zero files changed). Both were older scaffold variants: their placeholder Host command and scaffold docs are superseded by the fixed implementation.
- The fixed source snapshot (`6653aa7eb55e30b4d513554e9ccbb986ccb4fb1f`) was compared with the integrated picker. Its model-list behavior is present on the line; remaining differences were formatting/configuration, the unused `Plugin.module.css`, and test refinements. The CSS file is not imported by the plugin.
- The integration commit (`21a0ef81b65509553638a0f375dbc764df7bc7a9`) and clean line parent (`962dedf132039617940c3683f806a2975244e1c0`) have no diff in picker, E2E, or capability files other than a trailing comma in `runtime-capabilities.ts`. Current `default@` (`a265877111cdcf2e886421a67d666082ec62209a`) descends from that parent.
- Before cleanup, all four picker workspaces were moved to empty working-copy commits over the same current line commit, and each passed `jj status` clean plus `jj diff --from @ --to a265877111cdcf2e886421a67d666082ec62209a --stat` with zero changed files. The `model-effort-picker-fixed` workspace remains; the `model-effort-picker`, `model-effort-picker-main`, and `model-effort-picker-integration` workspace registrations were forgotten. Their source revisions remain available in shared history.

### Source revisions

| Snapshot | Commit |
| --- | --- |
| Older `model-effort-picker` | `e3439debe80ed366193fc1d7f7e8a58a959cedfc` |
| Older `model-effort-picker-main` | `00a0092805625c2df61e6cdbaee1478b34660842` |
| Selected fixed source | `6653aa7eb55e30b4d513554e9ccbb986ccb4fb1f` |
| DSHX model capability | `8015dbbd0a89777e832deb042fdac82900b79b4f` |
| Picker + E2E integration | `21a0ef81b65509553638a0f375dbc764df7bc7a9` |
| Formatting follow-up | `72e902c26c7a749bc1b7ec7dad1b6f4df29ebf24` |

The three unregistered workspace directories remain on disk at the canonical line tree. Old source snapshots remain recoverable by the commit IDs above. No unrelated workspaces or commits were abandoned.

## Validation and remaining gates

- Passed earlier: plugin unit tests (4), lint, formatting, E2E feature generation, and workspace contract check.
- Picker-specific feature-catalog errors were fixed. The broad coverage report still has 88 unrelated baseline issues.
- Build/typecheck remain blocked by unavailable generated `@deepseek-ai/dsh-api-session-controller/client` and `/types` artifacts and DSHX CSS ambient types. Related implicit-any errors follow from those missing upstream artifacts.
- No isolated probe/browser runtime verification was completed. No live profile was modified or restarted.

## Recovery

The source revisions above remain in the shared JJ store. To inspect the selected source again, create a linked workspace at a new, unused path:

```sh
jj workspace add /Users/astahmer/dev/dshfiles-model-effort-picker-recovery \
  --name model-effort-picker-recovery \
  -r 6653aa7eb55e30b4d513554e9ccbb986ccb4fb1f
```

## Resume here

Resolve or generate the missing API/session-controller type artifacts, rerun the plugin build and typecheck, then perform isolated probe verification before any profile promotion.
