---
name: plugin-state
description: Pick and write client state in DSH plugins with the plugin-ui bindings — TanStack Query for Host/async data, TanStack Form + zod for multi-field forms, xstate v5 for tangled flows, createStoredValue for localStorage, useDebouncedValue for debounce. Use when a plugin component grows useState/useEffect/setInterval for server data, a form, a multi-step flow, or persisted preferences.
---

# Plugin state

Rule of thumb (current audit decisions: `plugins/@dshfiles/plugin-ui/docs/state-ownership.md`):

| State | Use | Import |
|---|---|---|
| Host / async data | `useQuery` / `useMutation` | `@dshfiles/plugin-ui/query` |
| Multi-field form | `useAppForm` + zod schema | `@dshfiles/plugin-ui/form` |
| Flow with ≥3 tangled states | xstate v5 machine | `@dshfiles/plugin-ui/machine` |
| localStorage | `createStoredValue` | `@dshfiles/plugin-ui/hooks/stored-value` |
| Debounced input | `useDebouncedValue` | `@dshfiles/plugin-ui/hooks/debounced-value` |

Do not add `@tanstack/*`, `xstate` or `zod` UI deps to a plugin directly — plugin-ui pins them.

## Query

Wrap each slot root once inside dshx `decorate(...)` (one client per plugin bundle):

```tsx
ctx.slots.register({ name: 'main', key: PANEL_ID }, decorate(props => (
  <PluginQueryProvider><SecretCatalogPanel t={props.t} /></PluginQueryProvider>
)))
```

Keys start with the plugin id, `signal` is forwarded, mutations invalidate by key, polling is `refetchInterval`
(never `setInterval`):

```ts
// ai-accounts/src/accounts-queries.ts
export const aiAccountsKeys = { usage: ['ai-accounts', 'usage'] as const }
usage: (accounts, refetchInterval: number) =>
  queryOptions({ queryKey: aiAccountsKeys.usage, queryFn: async ({ signal }) => normalizeUsage(await accounts.usage(undefined, { signal })), refetchInterval })

// secret-catalog/src/secret-catalog-panel.tsx
const createMutation = useMutation({
  mutationFn: (input: SecretCreateForm) => api.create({ ...input, cwd }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['secret-catalog', 'list'] }),
})
```

`errorMessage(error, fallback)` renders a failure without leaking non-Error values. A Host `{ ok: false }` result
should throw inside `mutationFn` so each mutation owns its error.

## Form

```tsx
// secret-catalog/src/secret-mutation-dialog.tsx
const form = useAppForm({
  defaultValues: secretCreateFormDefaults({ scope, environment }),
  validationLogic: revalidateLogic(),
  validators: { onDynamic: secretCreateFormSchema },   // zod 4 = Standard Schema
  onSubmit: ({ value }) => props.onCreate(toSecretCreateInput(value)),
})
<form.AppField name="alias">{field => <field.TextField label={t('fieldAlias')} monospace required />}</form.AppField>
```

Fields: `TextField`, `TextAreaField`, `SelectField`, `CheckboxField`, `SwitchField`, plus `form.SubmitButton`. Skip
the form store when the draft re-syncs from another source (it becomes a second source of truth).

## Machine

Only for flows like select → prepare → confirm → receipt. Machines own **flow** state; data stays in Query. Host
calls go through `fromPromise` actors with the `signal` forwarded, so leaving a state aborts the call. Pilot:
`jujutsu/src/workspace-restore-machine.ts`.

```ts
actors: {
  confirm: fromPromise<Receipt, { client: RestoreClient; previewId: string }>(async ({ input, signal }) =>
    unwrap(await input.client.confirmWorkspaceRestore({ previewId: input.previewId }, signal))),
},
```

```tsx
const [snapshot, send, actor] = useMachine(workspaceRestoreMachine, { input: { client, workspacePath, targetCommitId } })
useEffect(() => { const sub = actor.on('restored', () => onRestored.current()); return () => sub.unsubscribe() }, [actor])
```

## Storage and debounce

```ts
const storedRepoHistory = createStoredValue({ key: REPO_HISTORY_KEY, schema: z.array(z.string()), fallback: [] })
const history = storedRepoHistory.useValue()          // invalid/missing → fallback; synced across tabs
storedRepoHistory.set(nextHistory)                      // false if schema or quota rejects

const query = useDebouncedValue({ value: search, delayMs: 200 })   // feed into a query key
```
