# Replacing native DSH plugins

Use DSH core as the baseline, but own product-specific divergence in a dshfiles plugin. This is the default when a native UI is the right starting point but its behavior must be customized; it is not a reason to fork unrelated core plugins wholesale.

## Procedure

1. **Inspect the installed runtime.** Find the native Loader row and its id in the composed bundle/profile, read the exact installed package version and source, and inspect the live Slot declarations/props with Cordis Inspect. Do not infer contracts from a README or depend on DOM selectors.
2. **Choose the replacement boundary.** If supported slots or registration APIs can express the behavior, implement the replacement as an owned dshx plugin. If not, record the concrete Host/core gap rather than hiding it with a DOM workaround.
3. **Port the native behavior.** Start from the smallest native package that owns the surface. Preserve its license and notices; document the upstream repository, package/version, source path, and any core revision used. Keep the fork's imports on public runtime APIs, not another package's private `src` files. Compare upstream changes deliberately when the pinned source changes.
4. **Replace in profile composition.** Add the owned package link and bundle to the profile seed. In the owned bundle's `cordis.patch.yml`, disable the stock Loader row by its id and insert the namespaced replacement row; this makes the plugin self-contained in scratch profiles too. Use the profile's `cordis.patch.yml` only for profile-specific overrides. A single-slot replacement must not leave both owners active. For `web`, use `pnpm profile:sync --profile web`; do not hand-edit the live profile.
5. **Preserve the whole surface.** A replacement must fill every native Slot it disables, including secondary history/tool renderers and document-level behavior—not just the UI that motivated the fork. Verify the installed signatures with Inspect and cover navigation, loading, errors, cleanup, and keyboard accessibility in tests.
6. **Verify without restarting the live instance.** Run plugin build, typecheck, unit tests, Host import check, and `pnpm check:e2e <plugin>`; use `probe` or `verify-dsh` for runtime evidence. A profile composition change requires a user-controlled restart. Report source validation, profile seed status, and runtime rollout separately.

The `@dshfiles/attachment-gallery` plugin is the reference example: it disables native Loader row `ui-attachment`, fills the four attachment/image Slots, retains the MIT notice and upstream provenance, and owns the gallery navigation behavior.
