# @dshfiles/plugin-ui

Shared UI for dshfiles DSH plugins. See `plans/plugin-ui-library.md` for the why.

Three layers, each owned once:

| Need | Import from | Notes |
|------|-------------|-------|
| Buttons, inputs, checkbox, switch, tags, pills, state dots, menus, tooltips, modal, segmented control, toasts, icons | `@deepseek-ai/dsh-client-ui-primitives` | Host platform module: always external, already themed. Never restyle these. |
| Field wiring, textarea, select, notice, empty state, section, confirm dialog, visually hidden | `@dshfiles/plugin-ui` | CSS Modules on `--dsw-*` tokens. |
| Async state | `@dshfiles/plugin-ui/query` | TanStack Query 5, re-exported, plus `PluginQueryProvider`. |
| Tables | `@dshfiles/plugin-ui/table` | TanStack Table **v9**, re-exported, plus `DataTable`. |
| Forms | `@dshfiles/plugin-ui/form` | TanStack Form 1, re-exported, plus `useAppForm` with bound field components. |
| Charts | `@dshfiles/plugin-ui/chart` | TanStack Charts 1 (`Chart`, marks, compact scales, `tooltip`) plus `ChartFrame`. |

Depend on it with `"@dshfiles/plugin-ui": "link:../plugin-ui"`. Do not add TanStack packages to a plugin directly — the subpaths pin one version for the workspace.

## Host primitives cheat sheet

```tsx
import { Button, Checkbox, Input, Modal, Pill, SegmentedControl, StateDot, Switch, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

<Button variant="primary" | "ghost" | "outline" | "toolbar" size="md" | "sm" icon={<IconX />}>Save</Button>
<Input icon={<IconSearch />} value={query} onChange={…} aria-label="Filter" />
<Checkbox checked={value} onChange={setValue} label="Clear tags" />
<Switch checked={value} onChange={setValue} label="Enabled" />
<Tag tone="outline" | "solid" | "neutral" | "quiet" | "success" | "info" | "warning" | "danger">Healthy</Tag>
<Pill active={selected} onClick={…}>project</Pill>       // filter chips
<StateDot state="done" | "warning" | "ongoing" | "error" | "idle" />   // aria-hidden: pair with text
<Modal open title="…" closeLabel="Close" onClose={…} footer={…}>…</Modal>   // mark first field with data-modal-autofocus
```

Read the full contracts in `node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/types/*.d.ts`.

## Gap components

```tsx
import { ConfirmDialog, EmptyState, Field, Notice, Section, Select, TextArea, VisuallyHidden } from '@dshfiles/plugin-ui'

<Field label="Alias" description="Letters, digits, dash" error={error} required>
  {control => <Input {...control} value={alias} onChange={…} />}
</Field>
<Select value={mode} options={[{ value: 'a', label: 'A' }]} onValueChange={setMode} aria-label="Mode" />
<Notice tone="info" | "success" | "warning" | "danger" title="…" actions={…}>…</Notice>
<EmptyState title="No aliases" description="…" action={<Button>Add</Button>} compact />
<Section title="Servers" description="…" actions={<Button>Add</Button>}>…</Section>
<ConfirmDialog open title="Delete alias?" confirmLabel="Delete" cancelLabel="Cancel" closeLabel="Close"
  tone="danger" busy={mutation.isPending} onConfirm={…} onCancel={…}>optional body</ConfirmDialog>
```

`fieldControlClassName` styles a plain `<input>` the Host `Input` cannot express (`type="color"`, a bare number input).

## Query

```tsx
import { PluginQueryProvider, errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'

// Wrap each slot root once (inside the dshx `decorate(...)` so useApi still works):
decorate(() => <PluginQueryProvider><Panel /></PluginQueryProvider>)

const api = useApi(contract)
const list = useQuery({ queryKey: ['secret-catalog', 'list', cwd], queryFn: ({ signal }) => api.list({ cwd }, { signal }) })
const queryClient = useQueryClient()
const create = useMutation({
  mutationFn: (input: CreateInput) => api.create(input),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['secret-catalog', 'list'] }),
})
```

- Prefix every key with the plugin id. Forward `signal` to the dshx client.
- One client per plugin bundle (`pluginQueryClient()`), shared by all of that plugin's slots.
- Imperative, security-sensitive, or timer-driven flows (secret reveal, drag reorder) may stay local; say why in a comment only if it is not obvious.
- Prefer TanStack Query over dshx `useApiQuery` in owned plugins.

## Table (v9 API — not v8)

```tsx
import { DataTable, createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable } from '@dshfiles/plugin-ui/table'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } })
const helper = createColumnHelper<typeof features, Row>()
const columns = helper.columns([helper.accessor('name', { header: 'Name', sortFn: 'alphanumeric' }), helper.display({ id: 'actions', header: 'Actions', cell: ctx => … })])

const table = useTable({ features, columns, data })   // keep features/columns stable (module scope or useMemo)
<DataTable table={table} empty="No rows" caption="…" />
```

Without `rowSortingFeature` headers are plain. Use `tableFeatures({})` for a static table.

## Form

```tsx
import { useAppForm } from '@dshfiles/plugin-ui/form'

const form = useAppForm({ defaultValues, validators: { onChange: zodSchema }, onSubmit: ({ value }) => mutation.mutateAsync(value) })
<form onSubmit={event => { event.preventDefault(); void form.handleSubmit() }}>
  <form.AppField name="alias">{field => <field.TextField label="Alias" required />}</form.AppField>
  <form.AppField name="scope">{field => <field.SelectField label="Scope" options={…} />}</form.AppField>
  <form.AppField name="enabled">{field => <field.SwitchField label="Enabled" />}</form.AppField>
  <form.AppForm><form.SubmitButton>Save</form.SubmitButton></form.AppForm>
</form>
```

Field components: `TextField`, `TextAreaField`, `SelectField`, `CheckboxField`, `SwitchField`. Errors show after a field is touched or a submit is attempted. Use the form for multi-field or validated input; a single search box stays `useState`.

## Chart

```tsx
import { Chart, ChartFrame, defineChart, lineY, scaleLinear, tooltip } from '@dshfiles/plugin-ui/chart'

const definition = useMemo(() => defineChart({ marks: [lineY(rows, { x: 'at', y: 'percent' })], scales: { x: { scale: scaleLinear }, y: { scale: scaleLinear } }, tooltip }), [rows])
<ChartFrame title="Quota"><Chart definition={definition} height={160} ariaLabel="Quota over time" /></ChartFrame>
```

`ChartFrame` maps `currentColor` and `--ts-chart-1..6` to DSH tokens. Docs ship in the package: `node_modules/@tanstack/charts/llms.txt`. TanStack Charts 1.0.0 is pinned exactly.

## Tests

The Host primitives cannot be imported under Node. Alias them to the shared double in the plugin's `vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: { alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../plugin-ui/testing/host-primitives.tsx', import.meta.url)) } },
})
```

If a plugin uses icons the double lacks, add them to `testing/host-primitives.tsx`.

## Rules

- No global selectors, resets, or unscoped element rules. Plugin CSS keeps layout and genuinely domain-specific visuals only.
- No new hard-coded colors; use `--dsw-*` tokens.
- Keep accessible names on icon-only buttons (`aria-label`).
