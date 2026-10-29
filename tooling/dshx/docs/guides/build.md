# Build and Vite extensions

**Config status: API Candidate**

**`host.vite` / `client.vite` status: Experimental**

**Config entries: `@dshfiles/dshx` or `@dshfiles/dshx/config`**

## Configuration

```ts
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "@dshfiles/dshx";

export default defineConfig({
  host: {
    entry: "src/host.ts",
  },
  client: {
    entry: "src/client.tsx",
    vite: {
      plugins: [tailwindcss()],
    },
  },
  build: {
    sourcemap: true,
    declarations: true,
    minify: false, // true minifies the production Client chunk; `dshx dev` never minifies
  },
});
```

```ts
interface DshxConfig {
  readonly name?: string;
  readonly host?:
    | false
    | {
        readonly entry?: string;
        readonly vite?: { readonly plugins?: readonly PluginOption[] };
      };
  readonly client?:
    | false
    | {
        readonly entry?: string;
        readonly vite?: { readonly plugins?: readonly PluginOption[] };
      };
  readonly profile?: string;
  readonly dev?: {
    readonly hostRestart?: "manual" | "auto";
    readonly hostHmr?: { readonly hostContractVersion: string };
  };
  readonly build?: {
    readonly sourcemap?: boolean;
    readonly declarations?: boolean;
  };
  readonly compatibility?: { readonly allowUnsupported?: boolean };
}
```

String face shorthand was removed. Resolution rules are exact:

| Face value         | Result                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------- |
| omitted            | Detect `src/host.ts` or `src/client.tsx`; disable the face when the convention file is absent |
| `false`            | Disable the face                                                                              |
| `{}`               | Enable the conventional path and error when the file is absent                                |
| `{ entry: '...' }` | Enable the explicit in-project file and error when it is absent                               |

DSHX reads only `dshx.config.ts`; it does not read `vite.config.*` and does not accept arbitrary Vite `UserConfig` fields.

`dev.hostRestart` defaults to `"auto"`: every successful Host rebuild serially restarts DSH so only one child process is active. Set it to `"manual"` when Host restarts must wait for an explicit `r` command.

`dev.hostHmr` replaces the Host implementation inside the running DSH process instead of restarting it. Each build publishes an immutable generation under `dist/.dshx-host-generations/<hash>.js`, points `dist/.dshx-host-manifest.json` at it, and regenerates the stable `dist/index.js` wrapper that DSH loaded at startup. The wrapper keeps the Loader contract (`name`, `inject`, `Config`) it was built with, watches the manifest, imports the new generation, disposes the previous Cordis fiber, and activates the replacement. A generation that fails to start is reported and the last-known-good one is restored; a failed generation is not retried until its content changes.

`hostContractVersion` is the boundary DSH cannot detect for you. It is compared on every activation, and a mismatch is refused with a restart instruction. Standard Schema has no canonical serializer, so DSHX cannot infer a stable schema fingerprint. Bump `dev.hostHmr.hostContractVersion` whenever Loader metadata changes: `name`, `inject`, or the shape of native `Config` / dshx `settings`. Code-only changes do not need a bump. Editing `dshx.config.ts` already reloads the project and restarts DSH.

The choice follows the boundaries in other plugin reload systems: OpenCode V2 scopes plugin lifetimes and restores failed activation; Pi stages extension registration, but neither offers the declared schema contracts DSHX must preserve. DSHX therefore swaps one Cordis generation at a time and requires the explicit version boundary for schema changes.

The feature is development-only and opt-in. `dshx build` still emits one self-contained `dist/index.js`, because `dev` is not read outside `dshx dev`. Disposal cancels nothing by itself: a plugin that owns timers, sockets, or subscriptions must register them through `ctx.effect` so the replaced generation releases them.

## Vite plugin contract

`plugins` accepts native Vite `PluginOption[]`, including nested arrays and promises. Vite `enforce` and `apply` ordering is retained. DSHX entry/browser guards run before user transformations; protocol, capability, and artifact guards run after them.

Plugins may resolve or transform modules, participate in the CSS/PostCSS pipeline, and use build/watch hooks. They may not override:

- `root`, `configFile`, or `publicDir`;
- Host or Client input entry;
- output format, filename, exports, code splitting, `manualChunks`, banner, intro, or footer;
- external module policy or build target;
- `assetsInlineLimit` or Client `cssCodeSplit`.

The resolved-config and output guards report the exact protected field. Call a stateful plugin factory separately for Host and Client; reusing the same plugin instance is rejected.

`dshx dev` uses Vite build-watch with `command: 'build'` and development mode. It is not a Vite dev server: a wholly serve-only plugin option is rejected, serve-only branches inside a mixed plugin factory are filtered out, and `configureServer` hooks do not run. A plugin may expose an optional `configureServer` hook, but it must also work through its build hooks. When config or dependency files change, DSHX closes old watchers, resolves both faces again, and switches only after a replacement session succeeds; a failed reload leaves the last-good session running while it waits for a fix.

## CSS and assets

Client CSS uses the standard Vite pipeline. CSS Modules, PostCSS, Tailwind, and user CSS plugins therefore behave like ordinary build plugins within the bounded output contract.

DSHX fixes `cssCodeSplit: false` and `publicDir: false`, and inlines imported images, fonts, and SVG files as data URIs. After Vite emits its single CSS asset, DSHX folds it into the lazy Client factory and removes the standalone asset. Factory materialization creates one owned element:

```html
<style data-plugin="package-id" data-plugin-css="package-id/client.css"></style>
```

Loading the registration script alone does not create the style; it is created when the lazy factory materializes. Official DSH plugin ownership removes the old element during HMR/disposal. The final Client output allows one JavaScript file, an optional sourcemap, declarations, and no independent CSS, asset, worker, WASM, or additional chunk.

## Shared runtime (opt-in)

Every Client chunk otherwise inlines its own copy of each third-party module and of its stylesheet. Plugins built from the same libraries can share one copy through the DSH module table, which already loads a package that another package lists in `dsh.client.external` before that consumer:

```ts
// supplier: an ordinary Client-only package with its own Loader row
export default defineConfig({
  client: { sharedRuntime: { provide: ['zod', '@tanstack/react-query', '@radix-ui/react-dialog'] } },
})

// consumer: also add the supplier to dependencies and to dsh.client.external
export default defineConfig({ client: { shared: '@scope/shared-runtime' } })
```

- The supplier's chunk exports `sharedModules` (one namespace per provided specifier) and writes `dist/shared-runtime.json`: each module's export names and the hash of its stylesheet.
- In a consumer, an import whose specifier exactly matches a provided module resolves to a small side-effect-free facade over `require(supplier).sharedModules[specifier]`. Other specifiers, subpaths included, stay private. A `bundleDependencies` entry wins over the supplier.
- When the consumer's CSS hash equals the supplier's, the consumer only emits its ownership marker and the supplier injects the sheet. A consumer whose CSS differs keeps injecting its own sheet.
- Build the supplier first. A missing manifest, or a supplier not listed in `dsh.client.external`, fails the build (`DSHX1208`, `DSHX4233`).
- A supplier module is shared by every consumer, so its module-level state is shared too: keep anything meant to be per-plugin (a per-bundle QueryClient, for example) in the consumer's own code.
- The Host must install the supplier: a consumer built with `shared` does not activate in a profile without it. To go back, drop `shared` and rebuild.

## Tailwind v4 without Preflight

Tailwind is optional and remains a generated-project dev dependency. Configure the standard plugin as shown above, then import a CSS-first stylesheet:

```css
@layer theme, utilities;

@import "tailwindcss/theme.css" layer(theme) prefix(dshx);

@import "tailwindcss/utilities.css" layer(utilities) source("./") prefix(dshx);
```

Omitting `tailwindcss/preflight.css` avoids resetting DSH's shared page DOM. Use the `dshx:` utility prefix and complete static class names, for example `className="dshx:flex dshx:gap-2"`; do not assemble class fragments dynamically.

## Artifacts and declarations

`build.sourcemap` defaults to `true`; `build.declarations` defaults to `true`. A mixed project emits:

```text
dist/index.js
dist/index.js.map       # when enabled
dist/index.d.ts
dist/client.js
dist/client.js.map      # when enabled
dist/client.d.ts
```

`dshx build` owns the whole output directory: it stages every face beside `dist/` and swaps the finished directory in, so files from an earlier build that this one no longer produces, including declarations and sourcemaps you turned off, do not survive. See [`dshx build`](../cli-reference.md#dshx-build).

The declaration files describe the actual DSH/Cordis module shape—`name`, `inject`, `Config`, and `apply(ctx, config)`—not the authoring `HostDefinition`/`ClientDefinition`. Shared contracts appear in public source declarations only when the plugin author explicitly exports them. Build and pack validation require every `package.json` `exports`, `types`, and `bin` path to exist.

## Commands

`dshx build` runs the same offline manifest, migration, and TypeScript checks as `dshx check` before building. `dshx dev` uses the same build kernel in watch mode and then coordinates the official DSH Profile/runtime. Programmatic build/watch APIs live in the experimental [Tooling](./tooling.md) entry.
