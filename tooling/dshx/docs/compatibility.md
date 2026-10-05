# Compatibility and verification

DSHX tracks DSH support by observable protocol generation. A generation changes
only when an official contract, API seam, loader behavior, or runtime invariant
needs different adaptation; a DSH patch or minor release alone does not create
one.

This fork supports one generation, `protocol-2`. Protocol-1 (DSH `0.1.x`) was
retired with its adapter, fixtures, and smoke script; the adapter registry
stays generic so a future generation can be added beside it.

## Source of truth

`packages/dshx/src/compat/protocol-2.ts` is the generation record.
`packages/dshx/src/compat/index.ts` validates the registry, analyzes plugin
ranges, selects the adapter, and reports capabilities.

| Field | Value |
|---|---|
| DSH range | `>=0.2.0-rc.1 <0.3.0-0` |
| Verified versions | `0.2.0-rc.1`, `0.2.0-rc.2` |
| Node range | `^22.19.0 \|\| >=24.0.0` |
| Settings service | `configForms` from `@deepseek-ai/dsh-client-ui-settings` |
| Conversation contracts | `@deepseek-ai/dsh-client-ui-conversation` |
| Custom durable event vocabulary | not available |
| Conversation component contributions | not available |

## What protocol-2 changed

- `@deepseek-ai/dsh-client-runtime` no longer exists. Its types moved to
  `@deepseek-ai/dsh-client-ui-conversation/client`; `ChatConversationViewNode`,
  `ChatNodeOwnerProps`, and `UseChatNodeTurnData` moved to
  `@deepseek-ai/dsh-client-ui-chat/client`.
- The `conversationEvents` registry is gone, so `defineConversation` renderers
  fail with `DSHX2302`. Use ordinary typed UI slots.
- Settings inverted. A plugin no longer registers a namespace object; a
  namespace is identified by its Loader entry id and read through
  `ctx.settings.describe()` and `update()`. The Host binds a scope façade and the
  Client binds through `ConfigForms` (`ConfigForms.get(entryId)` plus
  `ConfigForms.describe()` replace `SettingsScopeBinder`).
- The context no longer carries the plugin's config. Generated Host code
  forwards `apply(ctx, config)`'s config to `setup(ctx, config)`, unwrapping
  schemastery's resolvers first.
- `dshx/host` re-exports cordis's `Events` augmentation, so `ctx.on` accepts DSH
  event names. This only holds when the plugin and the toolchain resolve one
  cordis identity; see the repository AGENTS.md.

## Live Slot Inspect

DSH `0.2.0-rc.2` registers the first-party `Slots.listSubTree` provider in
`@deepseek-ai/dsh-cordis-client-runner`. `dshx inspect slots` reports the live
Client composition as flat rows. Each row preserves its `type`: Slot nodes have
a registration `kind`, while Factory nodes are topology containers without a
`kind`. Factory children appear as their own rows; nested `children` are omitted
from each flattened row so a large composition is not duplicated in the bounded
Host bridge response.

Use `dshx inspect slots --root <slot-name>` for that live Slot's declaration,
catalog, and current occupants. `dshx add ui` uses those exact facts, offers
only Slot nodes as contribution targets, and reports `DSHX6110` without writing
when a Factory is selected. `dshx inspect slots --explain` remains a separate
offline view of declarations and known shipped occupants; it does not claim
current profile occupancy. Missing browser synchronization or unavailable
runtime facts still produce explicit diagnostics rather than a successful empty
result.

## Versions in a plugin

A plugin declares public support in `peerDependencies` and pins the concrete
DSH it builds and tests against in `devDependencies`:

```json
{
  "peerDependencies": { "@deepseek-ai/dsh": ">=0.2.0-rc.1 <0.3.0-0" },
  "devDependencies": { "@deepseek-ai/dsh": "0.2.0-rc.2" }
}
```

`dshx build`, `dev`, and `check` report diagnostics when the peer range is
missing or invalid, extends beyond the supported range, spans generations, does
not contain the installed DSH, or when the devDependency floats.

## Status semantics

| Status | Meaning |
|---|---|
| `verified` | The installed DSH is one of the verified versions above. |
| `compatible` | An unverified stable version inside the range; runs with a warning. |
| `experimental` | An unverified prerelease inside the range; runs with an explicit warning. |
| `unsupported` | Outside every range. Rejected unless `compatibility.allowUnsupported` is set for temporary diagnosis. |

Semver membership never implies a real boot. `dshx check --json` reports the
static assessment; `dshx check --runtime --json` adds the resolved Profile,
runtime plugins, bridge, and readiness.

## Verifying a DSH version

The evidence for a version is a real boot, not a range match:

1. Run `dshx check --boot` in each plugin. It boots a throwaway profile with the
   plugin installed and fails on any "did not activate" line.
2. Boot the `web` profile with every owned bundle and read the activation
   lines it prints.
3. Only then add the version to `VERIFIED_PROTOCOL_2_VERSIONS`.

A seam that moved needs a new adapter, not a wider range. Compare the Profile,
manifest, Host and Client loader, Tool, Command, Slot, connection, Inspect,
restart, and HMR seams first, and record what changed in the list above.
