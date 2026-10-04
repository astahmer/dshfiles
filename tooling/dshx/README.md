# DSHX

Build, check, and debug typed DeepSeek Harness (DSH) plugins.

This is our hard fork of [liyown/dshx](https://github.com/liyown/dshx), owned
as `@dshfiles/dshx` and maintained against the DSH generation this repository
runs (`protocol-2`, DSH `0.2.x`). It is private: plugins under
`plugins/@dshfiles` link it by path, and nothing is published. Provenance and
license are in [FORK.md](./FORK.md); the original MIT license is in
[LICENSE](./LICENSE).

DSHX is build-time tooling. Official DSH and Cordis services still own
execution, registries, scopes, transport, persistence, assembly, HMR, and
disposal.

## Create a plugin

From the repository root, after building this tree:

```bash
node tooling/dshx/packages/dshx/dist/cli/bin.js create plugins/@dshfiles/my-plugin
```

Templates are `starter | showcase`; styles are `css-modules | tailwind | none`.
Then link the package from `plugins/` and install it into a profile as the
repository AGENTS.md describes.

## Authoring example

```ts
// src/api/status.ts
import { defineApi, method } from "@dshfiles/dshx/api";

export const statusApi = defineApi({
  id: "status",
  version: 1,
  methods: {
    get: method<void, { readonly ready: boolean }>(),
  },
});
```

```ts
// src/host.ts
import { defineHost } from "@dshfiles/dshx/host";
import { statusApi } from "./api/status.js";

export default defineHost({
  apis: [
    statusApi.host({
      get: () => ({ ready: true }),
    }),
  ],
});
```

```tsx
// src/client.tsx
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import {
  defineClient,
  defineLocale,
  defineSlot,
  useApiQuery,
  type PropsLocaleOf,
} from "@dshfiles/dshx/client";
import { statusApi } from "./api/status.js";

const copy = defineLocale("my-plugin.status", {
  zh: { ready: "就绪", unavailable: "不可用" },
  en: { ready: "Ready", unavailable: "Unavailable" },
});

function Status({ t }: PropsLocaleOf<typeof copy>) {
  const query = useApiQuery(statusApi, "get", { enabled: true });
  if (query.status === "pending") return <p>{query.fetchStatus}</p>;
  if (query.status === "error")
    return <button onClick={query.refetch}>Retry</button>;
  return <p>{t(query.data.ready ? "ready" : "unavailable")}</p>;
}

const statusSlot = defineSlot("sidebar.footer.action", {
  id: "my-plugin.status",
  order: 0,
  locale: copy,
  component: Status,
});

export default defineClient({ locales: [copy], slots: [statusSlot] });
```

`defineLocale` infers one exact key set, registers its dictionaries before Slots, and gives the component a typed `t()`. The package still declares `@deepseek-ai/dsh-client-locale` in `dsh.client.inject`; `create-dshx` writes this provider edge. `useApiQuery` surviving final tree-shaking drives the `connection` capability automatically.

## Public surfaces

| Entry                           | Status                 | Purpose                                                              |
| ------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `@dshfiles/dshx` and `/config` | API Candidate          | Browser-safe `defineConfig` and `DshxConfig` only                    |
| `/host`                         | API Candidate          | Host definitions, Tools, Commands, Prompt contributions              |
| `/client`                       | API Candidate          | Client definitions, Locales, Slots, API/Settings Hooks               |
| `/api`                          | API Candidate          | Shared typed unary API contracts and opaque errors                   |
| `/settings`                     | API Candidate          | Shared Schemastery-backed Settings contracts                         |
| `/experimental/conversation`    | Experimental           | Pure official event lifecycle plus React renderer                    |
| `/tooling`                      | Tooling / Experimental | Node-only compiler, compatibility, diagnostics, CLI, and repair APIs |

`0.x` shapes are not stability guarantees; this fork changes them when DSH does.

## Technical documentation

| Chapter                                              | APIs and behavior                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| [Host](./docs/guides/host.md)                        | `defineHost`, contribution order, injects, lifecycle                    |
| [Client, Locale, and Slots](./docs/guides/client.md) | `defineClient`, `defineLocale`, `defineSlot`, official props and wiring |
| [Typed API](./docs/guides/api.md)                    | Standard Schema, handlers, imperative calls, `useApiQuery`, errors      |
| [Settings](./docs/guides/settings.md)                | contract, Host facet, decoder, secrets, Hook state and mutations        |
| [Prompt](./docs/guides/prompt.md)                    | Section, Context, ordering, assembly ownership                          |
| [Conversation](./docs/guides/conversation.md)        | experimental `initial/reduce/project/render` lifecycle                  |
| [Build](./docs/guides/build.md)                      | bounded Vite plugins, CSS/assets, Tailwind, declarations, watch         |
| [Creator](./docs/guides/creator.md)                  | template/style matrix and programmatic generation                       |
| [Tooling](./docs/guides/tooling.md)                  | programmatic build/watch, compatibility, diagnostics, repair            |

## CLI

```bash
dshx check                 # offline config, manifest, migration, compatibility, TypeScript
dshx check --runtime       # additionally require Profile, Composition, bridge, runtime readiness
dshx build                 # typecheck, then build Host and Client artifacts
dshx dev                   # Vite build-watch plus official DSH development session
dshx inspect slots
dshx add ui --slot <slot-name>
```

`check` is read-only unless `--fix` is explicit. `build` does not rewrite source or manifest metadata. `inspect` requires a supported running Composition. See the [CLI reference](./docs/cli-reference.md) for all commands and JSON fields.

Also see the [CLI reference](./docs/cli-reference.md),
[Compatibility](./docs/compatibility.md), [Architecture](./docs/architecture.md),
and [Agent communication](./docs/agent-communication.md).

## Develop this tree

```bash
pnpm install --frozen-lockfile
pnpm --filter create-dshx build
pnpm --filter @dshfiles/dshx build
pnpm check        # typecheck, test, build both packages
pnpm lint
pnpm deps:check   # knip
```

## License

[MIT](./LICENSE) © DSHX contributors.
