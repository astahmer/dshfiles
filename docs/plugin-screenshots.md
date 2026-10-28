# Plugin screenshots

Every plugin that renders UI ships at least one screenshot. It is what the
README shows and what a marketplace card shows, so it is part of the plugin,
not an optional extra: a plugin nobody can see is a plugin nobody installs.

## The rule

- A plugin whose catalog (`plugins/@dshfiles/<name>/dshx.features.json`) lists a
  feature with the `client` surface keeps **at least one** capture in
  `plugins/@dshfiles/<name>/docs/screenshots/`. A plugin that renders more than
  one distinct screen may keep one per screen.
- The file is named after the catalog feature the capture walks
  (`docs/screenshots/<feature-id>.png`), so a screenshot and the verified path
  cannot drift apart: `dshx dev open` walks the same `reach` steps first.
- The README embeds it under its title: `![<feature title>](docs/screenshots/<feature-id>.png)`.
- Refresh it after a **significant** UI change — a new surface, a moved control,
  a restyle, a different default view. Re-capture only the screen that changed.
  Copy edits, internal refactors and bug fixes behind the same pixels do not
  need one.
- Keep the file small: a viewport capture, cropped to the surface that matters,
  under 400 KB. The check fails above 1 MB.

A plugin without a `client` surface (a library, a Host-only bundle) is out of
scope: `credential-port`, `optmem-core`, `plugin-ui` (kit), `shared-runtime`,
`shared-streams`, `ui-styles`, `session-search`, `fff-search` and
`subprocess-local` carry no UI of their own.

## Capture

Screenshots come from a scratch DSH, never from a live personal installation
([verify-dsh](../.agents/skills/verify-dsh/SKILL.md)):

```sh
# once per checkout
pnpm exec turbo run build --filter=@dshfiles/dshx
pnpm --dir plugins run build

dshx() { fnm exec --using="$(cat .node-version)" node "$PWD/tooling/dshx/packages/dshx/dist/cli/bin.js" "$@"; }
dshx dev up --name shots                    # every owned bundle, headless Chromium
node --run screenshots -- --missing-only     # capture only plugins still missing one
node --run screenshots -- --only backlog     # or several: thread-sidebar,jj-integration
node --run screenshots -- --only backlog --feature backlog-mentions   # a second screen
dshx dev shot --label ad-hoc                # an ad-hoc capture while the instance runs
dshx dev down --name shots
```

`node --run screenshots` drives each target's `reach` steps with `dshx dev
open`, captures the resulting page with `dshx dev shot`, writes
`docs/screenshots/<feature-id>.png` and embeds it in the README. Add
`--missing-only` to capture only UI plugins that currently lack a screenshot;
combine it with `--only` to scope the batch. A plugin is targeted by its first
reachable feature unless it appears in the script's `primaryFeatures` map (the
surface that shows the plugin best) or `--feature` names others.

`pnpm screenshots` is the same script without `node --run`'s argument
forwarding rules, so `pnpm screenshots --only backlog` reads naturally there;
`--name <instance>` (default `shots`) picks which scratch DSH to drive.

## The check

```sh
node --run check:screenshots            # gate: every UI plugin has one and its README embeds it
node --run check:screenshots -- --missing   # the same list, without failing
node --run check:screenshots -- --stale     # also list captures older than src/
```

The check derives the UI plugins from the feature catalogs, so a new UI plugin
is covered the moment its catalog lists a `client` surface. It fails on:

- a UI plugin with no screenshot;
- a screenshot file the README does not reference, or a missing README;
- a capture over 1 MB.

`check:green` runs it, so a UI plugin cannot land without its showcase. `--stale`
is a hint, not a gate: `src/` changing after the last capture does not prove the
UI moved.

## Honest limits

- A feature with no `reach` steps has no screenshot path. Add the steps (skill
  `maintain-verify-dsh`), do not hand-crop a screenshot of an unverified screen.
- Use synthetic scratch seeds (for example the `sample` project and a seeded
  thread), not the user's accounts, threads or folders. Isolation alone does not
  guarantee privacy: environment-derived usernames, hostnames, shell prompts and
  paths can still appear. Inspect every capture before publication.
- Public capture privacy note: identifier regions in selected retained captures
  are opaquely redacted for publication; private originals are retained. These
  are not unaltered captures, and the redaction is not product-behavior proof.
  Keep at least one verified synthetic UI capture per UI plugin. The three raw
  account-dashboard design references are omitted, not described as sanitized
  screenshots. Do not redact controls/results to fabricate a passing journey.
- The screenshot is evidence of the recorded path, not of every state: states
  that need an account, a quota block or a failure use the seeds `dshx dev` and
  the [e2e harness](e2e-testing.md) already provide.
