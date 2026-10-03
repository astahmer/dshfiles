# DSHX SDK research evidence

Snapshot: 2026-10-03. Companion to [architecture plan](./dshx-plugin-sdk.md).

Local links identify inspected files. SHA-256 fingerprints identify contents at research time; concurrent work in the external fork may change them. Native files come from the installed DSH dependency tree.

## Versions and verification boundaries

- DSHX fork: `0.1.4-preview.3`; Git HEAD read directly: `c9ea7e6eef5b04aef2360d60102309cbde53d36b`; upstream bookmark ref: `8048a780a263cbd788b71d316f2ec84a272158f8`. No Jujutsu snapshot/mutation in the other checkout.
- Installed DSH: `0.2.0-rc.2`; Cordis: `4.0.4`.
- Verified official fnm Node `v22.23.3`, executable `/Users/astahmer/.local/share/fnm/node-versions/v22.23.3/installation/bin/node`; pinned-Node `dsh --version` returned `0.2.0-rc.2`.
- BB package inspected: `@get-bb/plugin-sdk@0.4.47`. Current authoring references include newer API claims; package and guide evidence stay separate.
- Profile modules metadata: `pnpm@12.0.0`, store `v11`; running Host PATH not established.
- Native profile dump attempted; it tried to write generated `cordis.yml` and sandbox refused. No live composition/activation/browser verification claimed.
- No SDK implementation, installation, profile changes, Host restart, secrets access, or edits to the external fork.

## Fork

| ID | Inspected source | SHA-256 |
|---|---|---|
| F1 | [packages/dshx/src/host/types.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/host/types.ts) | `5cfa3ad8117da408716996d515ac93d68da58cdcf56dc66dbc486f41d73ac6b4` |
| F2 | [packages/dshx/src/host/runtime.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/host/runtime.ts) | `d8b1e5380213b686eba43c897db5b213321acc36ee792c184fa79b39133fdea6` |
| F3 | [packages/dshx/src/compiler/host/build.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/compiler/host/build.ts) | `74469cf60c20062e862e012b202ad4aea4696a3627e0fb4825af55a156ec2a1b` |
| F4 | [packages/dshx/src/compiler/client/build.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/compiler/client/build.ts) | `a86a0cedee38c9975a5f655bedec9870ec3b75b6973f83e4bc6a5c63817b4401` |
| F5 | [packages/dshx/src/api/runtime.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/api/runtime.ts) | `e02a63e675586be01f8f172d6f179ef05aa2665af9c02ba26558c6b66dc4fa4b` |
| F6 | [packages/dshx/src/compat/protocol-2.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/compat/protocol-2.ts) | `8e9aa69a02d5082a7d4940a60c5caa2881f05eff4280ab03c6ff94e3a57c092c` |
| F7 | [packages/dshx/src/client/runtime.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/client/runtime.ts) | `9b5e5cb3a089f3e714b3969222edbe79763747c1d1f14a4e1b9f496a97e8fdfd` |
| F8 | [packages/dshx/src/settings/client.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/settings/client.ts) | `00b3d8c2dd58f879ca736cff37b8c616d7f8d5d9d999a870c7c42ccaa21dda0d` |
| F9 | [packages/dshx/src/dev/orchestrator.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/dev/orchestrator.ts) | `3f44651d905a1a9bfe2cacc5a8a578e687200cd63f73527bff1082c3892f4200` |
| F10 | [packages/dshx/src/project/manifest.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/project/manifest.ts) | `28ede8f3aacc38d9050cea0348fd316bc805b9bebfe83cf4969d358573a70e87` |
| F11 | [packages/create-dshx/src/types.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/create-dshx/src/types.ts) | `6d35cb317b5b0bb282c4168426b66e8dbae498251488c0a76977bb5f6b85831a` |
| F12 | [packages/dshx/src/cli/args.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/cli/args.ts) | `dd492c0e33d39da0479ebc97cea8b049f17ba96b48e7e067865a0e1c197ca69b` |
| F13 | [docs/guides/build.md](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/docs/guides/build.md) | `c273771c8c2764ff4d6fc337a02159f61ed374fe27aa1e7854f9b7c6f6b717b1` |
| F14 | [packages/dshx/src/client/define.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/client/define.ts) | `fb2d1dbddc5c972ecdae354a39ba6e8aed5b87c0134136566d75dea7e1b1cf3f` |
| F15 | [packages/dshx/src/api/types.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/api/types.ts) | `9141c79d1317bee561671f48be1836103b80321a8d9d338490eb7d530fac0b8c` |
| F16 | [packages/dshx/tests/api.spec.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/tests/api.spec.ts) | `867cdc6f72fcd04c7dbb32ed0311ee46d22a2561594e245ac548b7142223e5db` |
| F17 | [packages/dshx/src/profile/orchestrator.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/profile/orchestrator.ts) | `29099ddeff46d31fa63d0d109ddd1a58818ee2169f2c273eb0b54c3da216fcd5` |
| F18 | [packages/dshx/src/compiler/host/guards.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/compiler/host/guards.ts) | `eec8191c8be3b9a0706db20225143fadd5cb704457562ddd63c0016e6a840d17` |
| F19 | [packages/dshx/src/compiler/client/guards.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/compiler/client/guards.ts) | `4c2a78fa23432f8324a5ecb098391cd0001b5de7b28a46fb2fbfa1e59336b075` |
| F20 | [packages/dshx/src/settings/define.ts](/Users/astahmer/Documents/deepseek-harness/default-workspace/forks/dshx-fork/packages/dshx/src/settings/define.ts) | `5a841bade777da2092924e4910289eef043e2ddf84b52b592143a2b5251d0439` |

## Native

| ID | Inspected source | SHA-256 |
|---|---|---|
| N1 | [dsh-agent-preset/skills/cordis-plugin-development/SKILL.md](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md) | `9e25dc1e310a77ed3e59e80ddaa3ce275b0336da8c84ff9c560840fba2c62595` |
| N2 | [dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md) | `ccfc3e1c7a98023f391eb24ad2f1cee1bcb984a26e77bcd994090041049eaa4b` |
| N3 | [cordis/src/fiber.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/cordis/src/fiber.ts) | `b7661d6c19be76cef6b97d88719a8112c0f8b5abe65bd9e7d5947773fd4b96d4` |
| N4 | [dsh-commands/lib/types/index.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-commands/lib/types/index.d.ts) | `5208f19179bd638f18b99b9386805896e187a0e64c9b7f76accf24d59ed4784c` |
| N5 | [dsh-tools/lib/types/schema.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts) | `a6c5f7f616d33b5281a3b3daad8b8f2a0085808b1707f9f318716b87aa484318` |
| N6 | [dsh-client-ui-slots/lib/types/index.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts) | `3eb9c5ecf65cfb65aee820e65f27ad1c80ca96dfbaa7122abd96aa5ea344be6a` |
| N7 | [dsh-settings/lib/index.js](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-settings/lib/index.js) | `9432b872597b7a31473072eb38a55979ab23375c76bd1d86d751388a692a0136` |
| N8 | [dsh-client-ui-renderer/lib/types/client/registry.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/types/client/registry.d.ts) | `8a3219d347eda4aca463d6baca99768b4f07da1b546479cd0bfcbb9a306e563a` |
| N9 | [dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts) | `8d181159cda8992cec0e990df2bfac60bb1777536465490df9e66d7a77523a79` |
| N10 | [dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts) | `e02c4d3fc25097f5ef4a426241e0f401d41f381e2474b7571e28fb4f2a07c6e6` |
| N11 | [dsh-client-shortcuts/lib/types/client/types.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-shortcuts/lib/types/client/types.d.ts) | `251a33133cc1f003ac1ae91509c6ab4824b6fb347bd1217a64090c95a514d8d8` |
| N12 | [dsh-client-modules/lib/types/client/manifest.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-modules/lib/types/client/manifest.d.ts) | `d416fc7327b3cdca52c530b0b4f51aba65f5aa5d025582f31acc1711e8b06752` |
| N13 | [dsh-client-hmr/lib/types/index.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-hmr/lib/types/index.d.ts) | `c1c6dd0de045b101fd8e8d4b46f99ecf5c5c8767592d08fada20380b3a55ceea` |
| N14 | [dsh-client-ui-settings/lib/types/client/config-form.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/types/client/config-form.d.ts) | `00b232c6b52a1399372907d164a9a58454cbb84c67e353cbb14a89155f8a1dd9` |
| N15 | [dsh-client-connection/lib/types/rpc.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-connection/lib/types/rpc.d.ts) | `3ca86c027408eb2dd6f1aa6efba0778b0f14802d638fc2f66bced8c5e698b0a4` |
| N16 | [dsh-session/lib/types/index.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts) | `8c6244c55203351724078ddb18e9075d82ec8c1e5087a13cff594681383ccba8` |
| N17 | [dsh-agent/lib/types/runtime-types.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts) | `07e00646b0c07eda239c102ea736a3bf29c431f34aee97fd7619ea0150d3c71a` |
| N18 | [dsh-client-ui-conversation/lib/types/client/contract/input.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/input.d.ts) | `937595f0c9f2722fa70fae3ea9fa742c34907f3cd6f14053be5a30921573ab04` |
| N19 | [dsh-client-ui-settings/lib/types/client/config-form-types.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/types/client/config-form-types.d.ts) | `273c31bde5dee13ae31df690f4a6b13e87f6404de6aa841c7c5bd59df3235805` |
| N20 | [dsh-client-ui-layout/lib/types/client/service.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/service.d.ts) | `5a7ba6db633eeda6792179fd13be316dcc06fd640b5413e2267068f70db7424e` |
| N21 | [dsh-client-ui-layout/lib/types/client/index.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts) | `195106dc8a9aa413cb5e41834798f62555fef20fe7eae719c9ac32b69a525f2e` |
| N22 | [dsh-client-ui-primitives/lib/types/Toast.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/types/Toast.d.ts) | `4a0ab1f9b18516fa8297fe9cd4d80885adb975e1e919e77e4b308cdf0818e433` |
| N23 | [dsh-client-connection/lib/index.js](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js) | `3950f524aed44e28240140a254cd928ea40eba8e2d04cc8fd04f92a687f5c91d` |
| N24 | [cordis/lib/types/events.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/cordis/lib/types/events.d.ts) | `f72cc0e13b57c436817ab8199268bc7defc609c7121f8fda49018ca919bf84c9` |
| N25 | [dsh-settings/lib/types/schema.d.ts](/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/node_modules/@deepseek-ai/dsh-settings/lib/types/schema.d.ts) | `d410d413da526656091ff171ab07a45d9d67c827324709723571ac2956fae11e` |

## BB

| ID | Inspected source | SHA-256 |
|---|---|---|
| B1 | [bundled-types/bb-plugin-sdk.d.ts](/Users/astahmer/.bb/plugins/cache/git/github.com/aqidd/bb-plugin-command-code/633468d99f1b90439f47cf6e97d45ecc2a702bca/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts) | `9edf99ed6beabd434e472a3deca7baa9e8d4693885eb4eb99be910997a2d2bf0` |
| B2 | [bundled-types/bb-plugin-sdk-app.d.ts](/Users/astahmer/.bb/plugins/cache/git/github.com/aqidd/bb-plugin-command-code/633468d99f1b90439f47cf6e97d45ecc2a702bca/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts) | `70d5f3eefc369b830bc9141fb1f76a9f671041ed35d230e2206c05d319fbd2b7` |
| B3 | [bundled-types/bb-plugin-sdk-testing.d.ts](/Users/astahmer/.bb/plugins/cache/git/github.com/aqidd/bb-plugin-command-code/633468d99f1b90439f47cf6e97d45ecc2a702bca/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-testing.d.ts) | `5e89fab10028a1c309361b5a975c636c1727f6fd36865d8a3ed438687574c6eb` |
| B4 | [dist/app.js](/Users/astahmer/.bb/plugins/cache/git/github.com/aqidd/bb-plugin-command-code/633468d99f1b90439f47cf6e97d45ecc2a702bca/node_modules/@get-bb/plugin-sdk/dist/app.js) | `880aa41d0be2231a108a21fd9ecf85872b69a2b482ac8080c003e575bf7adee4` |

### Current BB authoring references

Supplementary guide evidence, newer than the inspected SDK. No SDK code copied.

- [references/backend-foundation.md](/Users/astahmer/.bb/runtime/global-skills/4f57ab4aaab749e0d26de94d3561a5b1dab0e0f63077fadf3ae3c4513eb70d83/skills/bb-plugin-authoring/references/backend-foundation.md)
- [references/frontend-registration.md](/Users/astahmer/.bb/runtime/global-skills/4f57ab4aaab749e0d26de94d3561a5b1dab0e0f63077fadf3ae3c4513eb70d83/skills/bb-plugin-authoring/references/frontend-registration.md)
- [references/testing.md](/Users/astahmer/.bb/runtime/global-skills/4f57ab4aaab749e0d26de94d3561a5b1dab0e0f63077fadf3ae3c4513eb70d83/skills/bb-plugin-authoring/references/testing.md)
- [references/quickstart.md](/Users/astahmer/.bb/runtime/global-skills/4f57ab4aaab749e0d26de94d3561a5b1dab0e0f63077fadf3ae3c4513eb70d83/skills/bb-plugin-authoring/references/quickstart.md)

## Upstream DSH source

Corresponding current implementation areas were inspected; installed contracts override mutable upstream master.

- [Commands](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/commands/src/index.ts)
- [Renderer slots](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-renderer/src/client/registry.ts)
- [Conversation contracts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-conversation/src/client/contract/slots.ts)
- [Settings](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/settings/settings/src/index.ts)

## OpenCode v2 source

Inspected current dev, not pinned release behavior. Package source reports 1.18.34 and exposes v2 subpaths. Older root hooks and new v2 contexts remain distinct.

- [Package exports](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/package.json)
- [Promise definition](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/v2/promise/plugin.ts)
- [Promise context](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/v2/promise/context.ts)
- [Registration handles](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/v2/promise/registration.ts)
- [Effect definition](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/v2/effect/plugin.ts)
- [Core adapter](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/plugin/host.ts)
- [Scope lifecycle](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/plugin.ts)
- [Catalog hooks](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/v2/promise/catalog.ts)
- [Lifecycle design status](https://github.com/anomalyco/opencode/blob/dev/specs/v2/catalog-config-plugin-lifecycle.md)

## First-slice reproduction targets

These behavioral tests remain implementation work. Source/contract mismatches are established; no claim these tests have passed.

| Finding | Native evidence | Fork evidence | Required proof |
|---|---|---|---|
| Removed settingsScope | N14 configForms declaration | F6/F7 settingsScope injection | Settings-hook client activates on protocol 2 |
| Removed conversationEvents | Conversation/client contract inspection | F6 comment admits removal; F7 still calls registry | Verified seam or unsupported diagnostic |
| Missing settings Config | N7 runtime.Config + volatileForm | F2 missing declarative Config | Native describe and writes expose generated entry |
| Duplicate policy | N7 configure rejects repeated owner | F2 configures each contribution | Diagnose/map multiple contracts before activation |
| False write acceptance lost | N19 boolean result | F8 Promise<void> structural cast | Refused writes remain false; UI refreshes |
| RPC authority ignored | N15 two arguments; N23 implementation | F5 third option and missing peer | Real trust and supported method policy |
| Caller ownership | N3/N8 | New facades pending | Setup failure, early dispose, async unload, declaration cycles, stale context |

## Documentation verification

Cross-checked source/contracts and source links; verified pinned Node/DSH version; checked design deliverable requirements. Examples remain proposed design specimens, not compiled or live plugin results. No application suite was run for this documentation-only change.
