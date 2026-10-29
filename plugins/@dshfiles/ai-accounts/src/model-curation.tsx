import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyDescription } from '@dshfiles/plugin-ui/components/ui/empty'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { ActionHint } from './panel-primitives.js'
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, StarIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
import type { AccountDraft, AccountsCatalog } from './api.js'
import { ModelCurationModel } from './model-curation-model.js'
import { AccountModelSettingsModel } from './account-model-settings.js'
import { KIND_LABEL } from './account-labels.js'

type CatalogModel = AccountsCatalog['models'][number]
export type CurationPatch = Partial<
  Pick<
    AccountDraft,
    'additionalModelIds' | 'hiddenModelIds' | 'favoriteModelIds' | 'modelOrder' | 'reasoningDefaults' | 'inheritModelSettings' | 'defaultReasoningEffort'
  >
>
const PROVIDER_DEFAULT = '__provider-default__'

/** Provider inheritance suspends saved overrides; editing a row explicitly resumes account customization. */
export const ModelCuration = (props: {
  readonly account: AccountDraft
  readonly catalog: readonly CatalogModel[]
  readonly onChange: (patch: CurationPatch) => void
}): JSX.Element => {
  const { account } = props
  const [view, setView] = useState({ instanceId: account.instanceId, search: '', expanded: false, adding: false, modelId: '' })
  const current = view.instanceId === account.instanceId ? view : { instanceId: account.instanceId, search: '', expanded: false, adding: false, modelId: '' }
  const updateView = (patch: Partial<typeof view>): void => setView({ ...current, ...patch })
  const inherited = AccountModelSettingsModel.inheritsModelSettings(account)
  const effective = AccountModelSettingsModel.effectiveModelSettings(account)
  const catalog = ModelCurationModel.catalogForCuration({
    catalog: props.catalog,
    additionalModelIds: account.additionalModelIds,
    hiddenModelIds: account.hiddenModelIds,
  })
  const activeCatalog = inherited ? catalog.filter(model => !(model.accountAdditional ?? account.additionalModelIds.includes(model.id))) : catalog
  const ordered = ModelCurationModel.curationRows(activeCatalog, effective.modelOrder, current.search)
  const shown = current.expanded ? ordered : ordered.slice(0, 5)
  const hidden = new Set(effective.hiddenModelIds)
  const favorites = new Set(effective.favoriteModelIds)
  const customModelId = ModelCurationModel.parseAdditionalModelId(current.modelId, account)
  const duplicate = catalog.some(model => model.id === customModelId)
  const customize = (patch: CurationPatch): void => props.onChange({ ...patch, inheritModelSettings: false })
  const addModel = (): void => {
    if (customModelId === null || duplicate) return
    customize({ additionalModelIds: [...new Set([...account.additionalModelIds, customModelId])] })
    updateView({ modelId: '' })
  }
  const membership = (ids: readonly string[], id: string, included: boolean): string[] =>
    included ? [...new Set([...ids, id])] : ids.filter(candidate => candidate !== id)
  const move = (id: string, delta: number): void => {
    const next = ModelCurationModel.curationRows(activeCatalog, effective.modelOrder, '').map(model => model.id)
    const index = next.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    customize({ modelOrder: next })
  }
  const toggleFavorite = (modelId: string): void => {
    // Inherited rows display native values, not paused local membership. Resume the clicked value without losing unrelated local favorites.
    const savedFavorites = account.favoriteModelIds.filter(id => id !== modelId)
    if (favorites.has(modelId)) savedFavorites.push(modelId)
    customize(
      ModelCurationModel.toggleFavoriteModel({
        modelId,
        orderedModelIds: ModelCurationModel.curationRows(catalog, account.modelOrder, '').map(model => model.id),
        favoriteModelIds: savedFavorites,
        hiddenModelIds: account.hiddenModelIds,
      }),
    )
  }
  const setEffort = (model: CatalogModel, value: string): void => {
    if (value !== PROVIDER_DEFAULT && !model.efforts.some(effort => effort.id === value)) return
    const next = { ...account.reasoningDefaults }
    if (value === PROVIDER_DEFAULT) delete next[model.id]
    else next[model.id] = value
    customize({ reasoningDefaults: next })
  }
  return (
    <section
      className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-background dshx:p-4"
      aria-label="Models"
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:justify-between dshx:gap-4 dshx:@max-pane-compact:flex-wrap">
        <div className="dshx:min-w-0 dshx:flex-1">
          <h3 className="dshx:text-base dshx:font-semibold">Models</h3>
          <p className="dshx:mt-0.5 dshx:text-xs dshx:text-muted-foreground">
            Choose which models from {KIND_LABEL[account.kind]} are available for this account.
          </p>
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3 dshx:@max-pane-narrow:w-full dshx:@max-pane-narrow:flex-wrap">
          <Combobox
            label="Model settings mode"
            value={inherited ? 'inherit' : 'customize'}
            options={[
              { value: 'inherit', label: 'Inherit from provider defaults' },
              { value: 'customize', label: 'Customize for this account' },
            ]}
            onValueChange={value => props.onChange({ inheritModelSettings: value === 'inherit' })}
            triggerClassName="dshx:h-8 dshx:w-56 dshx:text-xs dshx:@max-pane-narrow:w-full"
          />
          <div className="dshx:relative dshx:w-48 dshx:min-w-0 dshx:@max-pane-narrow:w-full">
            <SearchIcon aria-hidden className="dshx:pointer-events-none dshx:absolute dshx:left-2.5 dshx:top-2 dshx:size-4 dshx:text-muted-foreground" />
            <Input
              aria-label="Search models"
              type="search"
              placeholder="Search models…"
              value={current.search}
              onChange={event => updateView({ search: event.target.value, expanded: false })}
              className="dshx:h-8 dshx:pl-8 dshx:text-xs"
            />
          </div>
        </div>
      </div>
      <div className="dshx:overflow-x-auto dshx:rounded-md dshx:border">
        <table className="dshx:w-full dshx:min-w-[600px] dshx:border-collapse dshx:text-sm">
          <thead className="dshx:border-b dshx:bg-muted/20 dshx:text-left dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
            <tr>
              <th className="dshx:px-3 dshx:py-2 dshx:font-normal">Model</th>
              <th className="dshx:w-48 dshx:px-3 dshx:py-2 dshx:font-normal">Reasoning effort</th>
              <th className="dshx:w-28 dshx:px-3 dshx:py-2 dshx:font-normal">Show in picker</th>
              <th className="dshx:w-28 dshx:px-3 dshx:py-2 dshx:font-normal">Source</th>
              <th className="dshx:w-10">
                <span className="dshx:sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(model => {
              const favorite = favorites.has(model.id)
              const localEffort = effective.reasoningDefaults[model.id]
              const validEffort = model.efforts.some(effort => effort.id === localEffort) ? localEffort : undefined
              const custom = model.accountAdditional ?? account.additionalModelIds.includes(model.id)
              const overridden =
                !inherited &&
                (validEffort !== undefined ||
                  model.efforts.some(effort => effort.id === effective.defaultReasoningEffort) ||
                  hidden.has(model.id) ||
                  favorite ||
                  effective.modelOrder.includes(model.id) ||
                  custom)
              const fullOrder = ModelCurationModel.curationRows(activeCatalog, effective.modelOrder, '')
              const index = fullOrder.findIndex(candidate => candidate.id === model.id)
              const accountEffort = model.efforts.find(effort => effort.id === effective.defaultReasoningEffort)
              const nativeEffort = model.efforts.find(effort => effort.id === model.defaultEffort)
              const defaultLabel = accountEffort === undefined ? (nativeEffort?.name ?? 'Auto') : `Account default (${accountEffort.name})`
              return (
                <tr key={model.id} className="dshx:border-b dshx:last:border-b-0 dshx:hover:bg-muted/20">
                  <td className="dshx:px-2 dshx:py-2">
                    <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                      <Button
                        aria-label={favorite ? `Unstar ${model.name}` : `Star ${model.name}`}
                        aria-pressed={favorite}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                        className={cn(favorite ? 'dshx:text-warning' : 'dshx:text-muted-foreground')}
                        onClick={() => toggleFavorite(model.id)}
                      >
                        <StarIcon className={cn(favorite && 'dshx:fill-current')} />
                      </Button>
                      <ActionHint label={model.id}>
                        <strong tabIndex={0} className="dshx:min-w-0 dshx:truncate dshx:font-medium">
                          {model.name}
                        </strong>
                      </ActionHint>
                      {custom ? (
                        <span className="dshx:rounded-full dshx:bg-muted dshx:px-2 dshx:py-0.5 dshx:text-xs dshx:text-muted-foreground">Custom</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="dshx:px-3 dshx:py-1.5">
                    <Combobox
                      label={`Default reasoning effort for ${model.name}`}
                      value={validEffort ?? PROVIDER_DEFAULT}
                      disabled={model.efforts.length === 0}
                      options={[
                        { value: PROVIDER_DEFAULT, label: model.efforts.length === 0 ? 'Not supported' : defaultLabel },
                        ...model.efforts.map(effort => ({ value: effort.id, label: effort.name })),
                      ]}
                      onValueChange={value => setEffort(model, value)}
                      triggerClassName="dshx:h-8 dshx:w-full dshx:text-xs"
                    />
                  </td>
                  <td className="dshx:px-3 dshx:py-2">
                    <Switch
                      className="dshx:data-[state=checked]:bg-info"
                      aria-label={`Show ${model.name} in the picker`}
                      checked={!hidden.has(model.id)}
                      onCheckedChange={checked => customize({ hiddenModelIds: membership(account.hiddenModelIds, model.id, !checked) })}
                    />
                  </td>
                  <td className="dshx:px-3 dshx:py-2">
                    <span
                      className={cn(
                        'dshx:rounded-full dshx:px-2 dshx:py-1 dshx:text-xs',
                        overridden ? 'dshx:bg-accent dshx:text-accent-foreground' : 'dshx:bg-muted dshx:text-muted-foreground',
                      )}
                    >
                      {overridden ? 'Overridden' : 'Inherited'}
                    </span>
                  </td>
                  <td className="dshx:pr-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-label={`Actions for ${model.name}`} size="icon-xs" type="button" variant="ghost">
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={index === 0} onSelect={() => move(model.id, -1)}>
                          <ChevronUpIcon />
                          Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={index === fullOrder.length - 1} onSelect={() => move(model.id, 1)}>
                          <ChevronDownIcon />
                          Move down
                        </DropdownMenuItem>
                        {custom ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => {
                                const patch = ModelCurationModel.removeAdditionalModel({ account, modelId: model.id })
                                if (patch !== null) customize(patch)
                              }}
                            >
                              <Trash2Icon />
                              Remove additional model
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {ordered.length > 5 ? (
          <Button
            className="dshx:w-full dshx:justify-start dshx:rounded-none dshx:border-t dshx:px-4 dshx:text-xs"
            type="button"
            variant="ghost"
            onClick={() => updateView({ expanded: !current.expanded })}
          >
            {current.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            {current.expanded ? 'Show fewer models' : `Show ${ordered.length - 5} more models`}
          </Button>
        ) : null}
        {ordered.length === 0 ? (
          <Empty className="dshx:p-4">
            <EmptyDescription>
              {catalog.length === 0 ? 'No models returned yet. Sign in, then refresh the provider catalog.' : 'No models match this search.'}
            </EmptyDescription>
          </Empty>
        ) : null}
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <Button variant="ghost" size="sm" type="button" aria-expanded={current.adding} onClick={() => updateView({ adding: !current.adding })}>
          <PlusIcon />
          Add custom model
        </Button>
        <div className="dshx:flex dshx:items-center dshx:gap-3">
          <span className="dshx:text-xs dshx:text-muted-foreground">
            {activeCatalog.filter(model => !hidden.has(model.id)).length} shown · {activeCatalog.length} available
          </span>
          <Button
            size="xs"
            variant="ghost"
            type="button"
            disabled={activeCatalog.length === 0}
            onClick={() => {
              const allHidden = activeCatalog.every(model => hidden.has(model.id))
              customize({
                hiddenModelIds: allHidden
                  ? account.hiddenModelIds.filter(id => !activeCatalog.some(model => model.id === id))
                  : [...new Set([...account.hiddenModelIds, ...activeCatalog.map(model => model.id)])],
              })
            }}
          >
            {activeCatalog.length > 0 && activeCatalog.every(model => hidden.has(model.id)) ? 'Enable all' : 'Disable all'}
          </Button>
        </div>
      </div>
      {current.adding ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:p-3">
          <div className="dshx:flex dshx:gap-2">
            <Input
              aria-label="Additional model ID"
              maxLength={120}
              className="dshx:min-w-0 dshx:flex-1 dshx:font-mono! dshx:text-xs"
              value={current.modelId}
              placeholder={account.kind === 'opencode-go' ? 'opencode-go/step-5-preview-free' : 'provider/model-id'}
              onChange={event => updateView({ modelId: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addModel()
                }
              }}
            />
            <Button size="sm" type="button" variant="outline" disabled={customModelId === null || duplicate} onClick={addModel}>
              Add model
            </Button>
          </div>
          <p className="dshx:text-xs dshx:text-muted-foreground">Add an ID the provider catalog does not return. The account/provider prefix is optional.</p>
        </div>
      ) : null}
    </section>
  )
}
