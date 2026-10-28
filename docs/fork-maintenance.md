# Maintaining aligned public sources without private deployment state

Astahmer's `dshfiles` and Neolectron's fork share plugin and SDK source. Updating
these repositories is **not** upgrading DeepSeek Harness core or deploying a
running installation. Preserve authorship, licenses, native-fork provenance and
repository URLs; the inherited `@dshfiles` namespace alone does not establish
ownership.

```text
astahmer/dshfiles <── reviewed source alignment ──> neolectron/dshfiles
                                                       │
                                          separate, authorized deployment
                                                       v
                                      local artifacts + writable profile
                                                       │ user-controlled restart
                                                       v
                                              existing DSH launcher
```

## Public source and history contract

The intended publication workflow aligns **both public main branches** on the
same reviewed source snapshot. This is a contract, not a claim that either
remote has already been synchronized. Record exact fetched bases, candidate
heads, tree comparisons and remote readback in the coordinating sync receipt.
A local build or a closed PR does not prove two-main alignment.

The 28 October 2026 publication decision calls for a **sanitized snapshot on
fresh public lineage based on Astahmer's `92d0f010`**, not a merge of the old
unpublished fork history. Preserve the old unpublished `66ff1e44` source,
original workspaces and a private rollback backup outside the public lineage.
Copy only reviewed, sanitized files into the fresh candidate; never merge,
rebase or cherry-pick the private ancestry into it. A clean tip alone cannot
sanitize reachable history. This exception does not authorize rewriting any
already-public branch, deleting private originals or force-pushing.

Personal projects, including Resources/CRM/Automation and Bots/Dot/DSH MCP,
remain outside public `main` unless a new explicit decision selects them. Keep
unfinished project-specific components with their owning project. Existing
shared milestones are not implicitly removed merely because later work remains
private.

Historical scoped PR status is not the final source contract. PR #16 was closed
without merging its old draft; do not infer that either main still lacks its
features after full source alignment. Compare the actual selected trees and
behavior. Likewise, adopt useful PR #7 seeding coverage only after comparing the
current executable/environment-aware boot implementation.

## Skills and policy

- [dsh-upstream-sync](../.agents/skills/dsh-upstream-sync/SKILL.md): compare or
  integrate a reviewed source scope, preserving local work and stopping before
  deployment.
- [dsh-upstream-pr](../.agents/skills/dsh-upstream-pr/SKILL.md): prepare a selected
  contribution from a verified upstream base. Publishing requires separate
  authorization.

Creating or reading these skills authorizes neither synchronization nor
publication. Keep repository-specific instructions versioned here rather than
installing them globally by default.

The machine-readable register is [fork-policy.json](../fork-policy.json).
Ownership and contribution intent are separate:

| Category                  | Default handling                                             | Publication boundary                                                           |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Shared plugin             | Preserve upstream structure; keep deltas small and tested    | Review the selected behavior and dependencies                                  |
| Owned plugin              | Separate package, optional activation, explicit dependencies | Contribute when explicitly selected                                            |
| Shared infrastructure     | Small prerequisites, portable defaults                       | No personal configuration or deployment assumptions                            |
| Personal deployment/state | Machine-local and outside source snapshots                   | Never publish credentials, account observations or host-specific configuration |

`plugins` is keyed by unscoped slug. `ownership` is `shared` or `owned`; an
unregistered addition needs classification. `upstreamIntent` is `keep-local`,
`candidate`, `proposed` or `accepted`; the reason records the concrete delta and
PR URL when relevant. `candidate` is not permission to publish. Reclassify an
adopted contribution after verifying equivalent behavior.

`forkOnlyPaths` is a review-scope marker, not a secret filter, ignore rule,
merge protection or permanent prohibition on contributing maintenance tooling.
Do not mass-rename packages to imply ownership: imports, Loader IDs, profile
links and runtime contracts would change. Keep native-fork records intact;
they track DSH package provenance, a different upstream.

## Read-only audit

From the repository root, after verifying the selected upstream ref:

```sh
node scripts/fork-audit.mjs --upstream upstream/main
node scripts/fork-audit.mjs --upstream upstream/main --local feature/example
node --test scripts/fork-audit.test.mjs
```

The helper resolves commit IDs and a unique merge base, inventories tracked
plugin manifests and compares base-to-local, base-to-upstream and
upstream-to-local. It reports concurrent edits, deletions, name collisions,
ownership decisions, non-plugin drift and dirty filenames without reading
their contents. Concurrent edits are review candidates, not proof of conflicts.

It never fetches, writes, pushes, changes refs or touches profiles. Policy comes
from disk rather than the selected local commit. Unrelated or criss-cross
histories fail closed; review fresh-snapshot lineage and scopes outside
`plugins/@dshfiles/*` separately. With JJ, resolve explicit local/upstream commits
and inspect JJ status too: Git `HEAD` need not be the JJ working revision. Use
`--repo` only with a verified Git worktree and `--policy` for the selected policy
path. Without one, inspect native JJ inventories/diffs; do not claim a pure-JJ
helper run.

This audit is not a three-way merge, security scan, dependency solver or
inventory of unversioned installed artifacts. Preserve dirty work and wanted
installed-only changes privately before integrating source. Never replace the
installed tree without separate review and a rollback snapshot.

## Safe source alignment and selective PRs

1. Verify repository identities, actual VCS metadata and default branches.
2. Pin source refs and preserve unrelated dirty work and private originals.
3. For ordinary future updates, use an isolated ancestry-preserving integration.
   For the explicitly selected sanitized publication, use the fresh-snapshot
   contract above instead; do not import old private ancestry.
4. Review the complete outgoing files, commit history, fixtures, screenshots,
   lockfile and licenses. Shared defaults must not encode a person's environment.
5. Verify changed behavior against installed core contracts in a scratch DSH.
6. Land only the agreed scope; publish only with authorization and without a
   force-push. Verify both public main trees before reporting alignment.
7. Treat runtime staging, profile changes and restart as separate operations.

For a selective PR, start at the verified upstream base and port only the
selected behavior and real prerequisites. Do not overwrite a newer upstream
plugin with an older directory or open an unrelated whole-fork PR. The normal
PR source is a named branch in `neolectron/dshfiles`, targeting the discovered
default branch of `astahmer/dshfiles`; direct upstream pushes require their own
explicit authorization.

## Machine-local launch and deployment

The source launcher and supervisor are optional operational tools, not a
versioned personal deployment. Configure checkout location, profile, DSH home,
core executable and network preferences locally; see
[personal configuration](personal-configuration.md). Discover the active URL
and profile from current runtime facts rather than copying a historical port,
LAN address, home path or profile name from documentation.

A build in an isolated workspace does not update an installation serving a
different checkout. After source validation, an authorized deployment must
identify the canonical artifacts and exact selected bundles before rebuilding
or linking anything. Do not run an unseeded all-bundle profile sync against an
existing custom profile. Use explicitly selected bundles and preserve unrelated
profile settings, order, credentials and Session storage. See
[profile installs](profile-installs.md).

The supervisor is adapted from
[Astahmer's implementation](https://github.com/astahmer/nixfiles/blob/9daa1991c1d11f0689eac44171342b018f47cf6f/assets/dsh/supervise-web.mjs),
not a new reload subsystem. Its retained protocol and limits are documented in
[the supervisor provenance record](../scripts/supervise-dsh.UPSTREAM.md).
Installing a launcher is not activating it: an already-running Host retains its
original startup contract until the user chooses to stop and relaunch it.

When the supervisor and [HMR gate](../plugins/@dshfiles/hmr-gate/README.md) are
actually active, client-only builds can be announced to existing tabs, while
paired Host/client changes are deferred pending a user-managed whole-Host
restart. This is not a backend hot swap. Verify the watcher, served artifact
paths and gate state before promising delivery. Manual refreshes, new tabs,
arbitrary transitive dependencies and background jobs are not all protected by
that gate. The existing idle restart has a forced-busy fallback; it does not
promise to drain all jobs. See [plugin reload](plugin-reload.md).

Use isolated homes and stock-core fixtures for verification. A custom wrapper
may reset `HOME` or `DSH_HOME`; inspect it before trusting environment overrides
to provide isolation. Never stop or restart the live GUI for a source sync.

### Historical supervisor evidence, not current deployment proof

Isolated tests covered source/profile preparation, supervisor protocol, gate
models, real HTTP/SSE plus Chrome client-only reload, paired-backend deferral,
and **Restart when idle** producing exit 75 and a new Host PID/run identity.
A separate loopback fake-provider run held a turn beyond two idle polls, then
released it and observed the restart. These runs did not use real provider
traffic or update a live profile. Cancellation, the 30-minute forced-busy
fallback and forced-restart recovery remain unverified. Reproduce focused checks
when changing these contracts; do not treat historical results as current
activation evidence.

## Secret configuration is not secret values

The tracked `.secret.json` defaults to an empty `secrets` map. Personal aliases
belong in ignored `.secret.local.json` or the Secret CLI's global configuration,
not in shared defaults. The CLI merges scopes per alias: an empty local file
does not disable project aliases. Null/false entries and invented tombstone
flags are not supported masking contracts.

Resolved values live in the vault, not reference files. Rendered `.env` and
`.env.local` are ignored too. An ignore rule does not untrack files or erase
history. Rotate leaked credentials and review reachable history separately;
never copy live account/authentication/quota observations into publication
receipts or label them synthetic evidence.
