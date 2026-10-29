# Client and Slot API

**Status: API Candidate**

**Entry: `@dshfiles/dshx/client`**

## `defineClient(definition)`

```ts
interface ClientDefinition {
  readonly name?: string;
  readonly inject?: readonly string[];
  readonly locales?: readonly LocaleDefinition[];
  readonly conversations?: readonly ConversationContribution[];
  readonly slots?: readonly SlotContribution[];
  readonly setup?: (ctx: Context) => void | Promise<void>;
}
```

There are no Client `api`, `apis`, or `settings` fields. Calling `useApi`, `useApiQuery`, `useApiEvent`, or `useSettings` from retained Client code declares the corresponding capability.

```tsx
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import {
  defineClient,
  defineLocale,
  defineSlot,
  type PropsLocaleOf,
} from "@dshfiles/dshx/client";

const copy = defineLocale("my-plugin.status", {
  zh: { ready: "插件已就绪" },
  en: { ready: "Plugin ready" },
});

function Status({ t }: PropsLocaleOf<typeof copy>) {
  return <p>{t("ready")}</p>;
}

const statusSlot = defineSlot("sidebar.footer.action", {
  id: "my-plugin.status",
  order: 0,
  locale: copy,
  component: Status,
});

export default defineClient({
  name: "my-plugin",
  locales: [copy],
  slots: [statusSlot],
});
```

## `defineLocale(namespace, dictionaries)`

`defineLocale()` creates one opaque, plugin-owned Locale contribution and preserves its namespace and key union without requiring declaration merging:

```ts
const copy = defineLocale("my-plugin.status", {
  zh: { ready: "插件已就绪" },
  en: { ready: "Plugin ready" },
});

type CopyKey = LocaleKeyOf<typeof copy>; // "ready"
type CopyProps = PropsLocaleOf<typeof copy>; // { t(key): string }
```

`en` is required and complete: its keys are the namespace's key union. Every other locale id (`zh`, or a language-pack id such as `fr` or `pt-BR`) is optional and may be partial; it may not add a key `en` lacks. Values are strings only. A violation is a type error for literal dictionaries and `DSHX2402` at runtime. At registration dshx fills each locale's missing keys with the English text, so the native provider always receives complete `zh` and `en` dictionaries; other locales register through its single-locale form and appear once a language pack adds them with `ctx.locale.addLanguage()`.

```ts
const copy = defineLocale("my-plugin.status", {
  en: { ready: "Plugin ready", retry: "Retry" },
  zh: { ready: "插件已就绪" }, // retry shows "Retry"
});
```

### Plurals

A key with `_one` and `_other` variants (and optionally `_zero`) is a plural key. `plural(t, key, count, params?)` picks `key_zero` when `count` is 0 and that variant exists, then the `Intl.PluralRules` category of the active locale (read from `<html lang>`, which the native provider keeps in sync), then `key_other`. `{count}` and the other params interpolate through the native `t`. `PluralKeyOf<typeof copy>` is the union of plural base keys.

```tsx
import { defineLocale, plural, type PropsLocaleOf } from "@dshfiles/dshx/client";

const copy = defineLocale("my-plugin.files", {
  en: {
    files_zero: "No files",
    files_one: "{count} file in {folder}",
    files_other: "{count} files in {folder}",
  },
  zh: { files_zero: "没有文件", files_other: "{folder} 中有 {count} 个文件" },
});

const Files = ({ t, count }: PropsLocaleOf<typeof copy> & { count: number }) => (
  <p>{plural(t, "files", count, { folder: "src" })}</p>
);
```

Chinese plural rules select only `other`, so `zh` needs the `_other` variant, plus `_zero` when `en` defines one (otherwise the English zero text shows). Pass the definition to `defineClient({ locales: [...] })` to register and dispose its dictionaries, and to `defineSlot(..., { locale: copy })` to infer the component's typed `t()` prop. Locale definitions register before Conversations, Slots, and `setup(ctx)`.

The Client package manifest must still load the official provider:

```json
{
  "dsh": {
    "client": {
      "inject": ["@deepseek-ai/dsh-client-locale"]
    }
  }
}
```

Non-empty `locales` automatically requests the Cordis `locale` service, including when `setup(ctx)` also uses `ctx.locale`; do not repeat `"locale"` in `defineClient.inject`. A missing package edge is reported by offline check (`DSHX4221`) and build/dev (`DSHX1203`). A raw `locale: "provider.namespace"` remains supported for advanced integration with an official or augmented `LocaleNamespaceMap`, but it neither registers nor disposes dictionaries.

## `defineSlot(name, options)`

`name` must be a key of the official `SlotMap`. The provider's module augmentation supplies the valid names and the option/prop types, so import its `client` type entry when required.

`SlotOptions` supports the official Slot model:

| Option                                      | Meaning                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `component`                                 | React component receiving the composed props for the selected Slot kind          |
| `id`, `order`, `key`, and other kind fields | `KindOptions` selected by the official Slot declaration                          |
| `store`                                     | Official store declaration; component props receive its normalized `HandleOf<H>` |
| `inject`                                    | Maps official Slot/store inputs into additional typed component props            |
| `children`                                  | Declares child Slots consumed through `renderSlot` or `renderSlotChain`          |
| `locale`                                    | Selects an official locale namespace and adds its typed locale props             |
| `registrant`                                | Overrides official registration metadata where supported                         |
| `metadata`                                  | Supplies the slot-specific metadata declared by its Host contract                |

The helper preserves keyed/list/chain/session/maybe behavior from the official Slot types. If `children` are declared but the component does not consume `renderSlot` or `renderSlotChain`, `RendersCheck` produces a type error. `SlotContribution` is opaque: pass it to `defineClient({ slots })`; do not copy or inspect it.

### Host Settings targets

The DSH 0.2 `settings.section` contract can route a field target into a native section. A section opts in by declaring the ConfigForm entry ids it handles in `metadata.settingsTargets`; `dshx inspect slots --root settings.section --explain` reports the exact owner props and metadata shape.

The Host supplies `openSection(id)` for section navigation and `openSettingsTarget({ entryId, fieldPath })` for field navigation. The latter returns `false` when no unique live section advertises the entry. A routed section receives `target` with the same `entryId` and path plus a `requestId`; after focusing or handling the field, call `acknowledgeTarget(requestId)`. `fieldPath` is a readonly array of schema path segments, so dotted field names remain unambiguous.

```ts
defineSlot('settings.section', {
  id: 'my-settings',
  metadata: { settingsTargets: ['my-settings-entry'] },
  component: MySettingsSection,
})
```

Import `@deepseek-ai/dsh-client-ui-settings/client` as a type-only module so `settings.section` and its Host target props enter the typed SlotMap. The section owns how a path resolves to one of its controls; the Host owns opening the section and delivering the request.

### Settings search entries

A section can let a Settings search find its controls without being mounted. List them in `metadata.searchEntries`: each entry has a unique `id`, a `title`, and optional `description` and `keywords`, all matched by the search. TypeScript checks the shape, and only `settings.section` accepts `metadata`. The zod schemas `settingsSectionMetadataSchema`, `settingsSearchEntriesSchema` and `settingsSearchEntrySchema` (unique ids, non-empty titles, no unknown fields) are exported from `@dshfiles/dshx/settings`; the Client runtime itself carries no zod, so a bundle without a shared zod does not inline it, and the reader decodes what each bundle published.

```tsx
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { defineSlot, type SettingsSectionSearchProps } from '@dshfiles/dshx/client'

const Appearance = (props: PropsRuntime<'settings.section'> & SettingsSectionSearchProps) => {
  useEffect(() => {
    if (props.target === undefined) return
    const control = document.querySelector<HTMLElement>(`[data-settings-entry="${CSS.escape(props.target)}"]`)
    control?.scrollIntoView({ block: 'center' })
    control?.focus()
  }, [props.target])
  return <select data-settings-entry="theme">…</select>
}

defineSlot('settings.section', {
  id: 'appearance',
  label: 'Appearance',
  metadata: { searchEntries: [{ id: 'theme', title: 'Theme', description: 'Light, dark or system', keywords: 'color mode' }] },
  component: Appearance,
})
```

The native slot ledger keeps only `id`, `order`, `label` and `priority`, so dshx publishes the entries to a page-wide seat for as long as the section stays registered. A Settings shell reads it with `settingsSearchEntries()` and `subscribeSettingsSearchEntries(listener)`; a section registered imperatively through `ctx.slots.register` publishes its own with `publishSettingsSearchEntries({ sectionId, entries })` and calls the returned disposer with the registration's. When the user picks an entry, the shell opens its section with `target` set to the entry `id`; the section scrolls to and focuses that control. `@dshfiles/settings-shell` is the shell that does this, and under it `target` is that string rather than the field-target object above, which it does not route into sections; it decodes each section's entries with `settingsSearchEntriesSchema` and skips, with one console warning, a set that does not decode.

## Registration and lifecycle

Client registration order is:

1. Locale contributions, in array order.
2. Slots, in array order.
3. `setup(ctx)`.

Non-empty Conversations fail with `DSHX2302`: protocol-2 has no conversation event registry. Non-empty Locales add `locale`. Non-empty Slots add `slots`. Hook capabilities add `connection` or `settingsScope` only when the corresponding Hook module survives final tree-shaking.

Slot and Conversation components are wrapped with the current Client Fiber's API and Settings contexts. Contract identity maps belong to that Fiber and disappear on dispose/HMR; DSHX does not retain a global scope or API cache.

## Hooks

The Client entry exports:

```ts
useApi(contract);
useApiQuery(contract, method, options);
useSettings(contract);
```

Call Hooks only from React components. Calling one outside a DSHX Slot/Conversation renderer throws because no current Client runtime context exists. See [Typed API](./api.md) and [Settings](./settings.md).

## Native Client modules

A module with named `name`, `inject`, `Config`, and `apply` exports bypasses `defineClient()` and is forwarded as an official Client module. DSHX contribution helpers and Hook auto-wiring apply to declarative default exports.
