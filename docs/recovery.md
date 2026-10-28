# Recovering a broken DSH

A blank page, failed plugin activation or failing turns can come from source,
built artifacts, profile configuration, core or Node. A source checkout alone
does not capture all of those layers. Do not restart an active shared Host or
change its writable profile without the user's authorization.

## 1. Identify the selected installation

Read the current runtime context and local launcher configuration. Do not copy
another operator's profile name, checkout path or network address. The checked-in
`web` seed is an example composition, not proof of the live profile; see
[personal configuration](personal-configuration.md) and
[profile installs](profile-installs.md).

| Layer            | Inspect                                                       | Rewound by a source revision? |
| ---------------- | ------------------------------------------------------------- | ----------------------------- |
| DSH core         | The actual installed `@deepseek-ai/dsh` entry and version     | No                            |
| Writable profile | Selected profile manifest and patch under the chosen DSH home | No                            |
| Built plugins    | The selected source packages' `dist` output                   | Only after a rebuild          |
| Node             | The official runtime pinned by `.node-version`                | No                            |

Useful read-only checks from the repository root:

```sh
dsh --version
node scripts/dsh-lkg/cli.mjs list
```

Inspect what `dsh` resolves to first: a locally installed wrapper can select a
different core/home. Keep startup diagnostics private; they may include paths or
account metadata. A successful HTTP shell load is not proof that Session APIs
or client plugin activation work.

## 2. Optional last-known-good recovery

The [LKG tooling](../scripts/dsh-lkg/README.md) can retain a self-contained runtime
snapshot, including core, plugin artifacts, profile and interpreter identity.
It is not installed or enabled merely by cloning this repository. Check its
actual local store and launcher before using `dsh-lkg` or `dsh-recover`.

A configured recovery launcher uses the stored runtime rather than current
source artifacts. By default it copies private live data into separate recovery
state; this includes credentials and Sessions. Obtain authorization for that
copy, restrict its permissions and keep it outside version control. It does not
prove that a provider accepts copied credentials now. Recovery-state changes do
not automatically flow back into the live installation.

The recovery script supports:

| Variable            | Effect                            |
| ------------------- | --------------------------------- |
| `DSH_LKG_CLEAN=1`   | Start without copying live data   |
| `DSH_LKG_LIVE_HOME` | Select the source DSH home        |
| `DSH_LKG_PORT`      | Select the recovery listener port |

Use the URL actually printed by the selected recovery launcher; never publish
its launch token. APFS clone support and macOS immutable flags are platform
features, not cross-platform guarantees. Read the implementation's platform
requirements before relying on them elsewhere.

## 3. Diagnose the owner

- **Waiting for service X / entries did not activate:** compare the selected
  live patch with the matching core and plugin service contracts. A seed change
  outside the managed region may not reconcile an existing custom profile.
- **`unknown prompt variable`:** inspect the selected preset row and the current
  core's prompt-variable contract.
- **`failed to import`:** build the affected package and import-check its Host
  bundle using the intended official Node runtime. A successful install alone
  is insufficient.
- **HTTP works but `sessionController` is unavailable:** inspect activation and
  recomposition diagnostics. The controller may be waiting for `sessionQuery`,
  whose selected provider must remain registered for the Host lifetime.
- **`node-addon-require-builtin unsupported`:** verify official Node rather than
  the Nix Node build. Do not change global installations as a speculative fix.
- **Missing platform-native binding:** inspect the actual global pnpm layout and
  platform package resolution. A global virtual-store layout can prevent the
  addon loader from resolving its platform package. Repair only the verified
  installation, with an authorized rollback point.

### Host recomposition can lose a Session provider

Historical inspection found that a fresh boot activated a composition whose
already-running Host lost its Session surface after linked artifacts and profile
patches changed. That evidence is a recomposition failure, not proof that the
same problem is occurring now. Correlate actual Host start time, artifact/patch
mtimes, activation errors and API failures before attributing a current incident.

The checked-in seed disables native Host HMR; client HMR is separate. Inspect
actual selected rows rather than assuming a seed was deployed. Plugin selection
changes and Host code updates then need a user-managed restart. With the HMR gate
active, paired Host/client updates may be deferred; without it, an old Host may
receive a new client. Decode compatible snapshots and report unavailable methods
honestly. See [plugin reload](plugin-reload.md).

An external supervisor may implement health probes or restart policies. Neither
its existence nor any machine-specific Nix configuration is guaranteed by this
repository. Do not install or enable a restart policy while diagnosing without
separate authorization.

## 4. Snapshot and upgrade only with authorization

Operator commands can copy private data, run paid provider traffic when a turn
check is selected, update installations or remove old snapshots. Inspect their
full behavior and selected paths first. `DSH_LKG_ADMIN=1` bypasses the agent guard;
it is not itself authorization to mutate the store.

```sh
# Operator-only, after explicit approval and local configuration review:
DSH_LKG_ADMIN=1 node scripts/dsh-lkg/cli.mjs snapshot --label "<reviewed change>"
DSH_LKG_ADMIN=1 node scripts/dsh-lkg/cli.mjs upgrade <version>
```

Do not upgrade the global core in place before proving the selected profile and
plugins against the candidate. Preserve the previous healthy snapshot when
checks fail. A source revert cannot reverse shared-data migrations; retain an
appropriate private backup and document what it actually covers. Record scratch
health checks separately from real-provider acceptance and live activation.
