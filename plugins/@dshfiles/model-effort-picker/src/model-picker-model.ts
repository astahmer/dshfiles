import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { AccountsUsage } from '@dshfiles/ai-accounts/api'
import type { FallbackRoute } from '@dshfiles/ai-accounts/model-fallback-api'
import { UsageOverviewModel } from '@dshfiles/ai-accounts/usage-overview-model'
import { modelIdentity } from '@dshfiles/plugin-ui/components/model-mark'
import type { BrandKey } from './brand-marks.js'

type ModelGroup = ModelDirectoryState['groups'][number]
type CatalogModel = ModelGroup['models'][number]

export interface ModelQuota {
  readonly percent: number
  readonly label: string
  readonly onReserve: boolean
}

/** Tokens that name a model family; a model id or name carries at least one of them. */
const BRAND_TOKENS: readonly { readonly brand: BrandKey; readonly tokens: readonly string[] }[] = [
  { brand: 'openai', tokens: ['gpt', 'chatgpt', 'openai', 'codex'] },
  { brand: 'claude', tokens: ['claude', 'anthropic', 'haiku', 'sonnet', 'opus'] },
  { brand: 'google', tokens: ['gemini', 'google', 'gemma'] },
  { brand: 'deepseek', tokens: ['deepseek'] },
  { brand: 'meta', tokens: ['llama', 'meta'] },
  { brand: 'qwen', tokens: ['qwen'] },
  { brand: 'ling', tokens: ['ling', 'inclusionai'] },
  { brand: 'kimi', tokens: ['kimi', 'moonshot'] },
  { brand: 'mistral', tokens: ['mistral', 'devstral', 'codestral', 'magistral'] },
  { brand: 'grok', tokens: ['grok', 'xai'] },
  { brand: 'copilot', tokens: ['copilot'] },
  { brand: 'zhipu', tokens: ['glm', 'zhipu', 'chatglm'] },
]

const brandOfToken = (token: string): BrandKey | undefined => {
  if (/^o[1-9]$/u.test(token)) return 'openai'
  return BRAND_TOKENS.find(entry => entry.tokens.some(candidate => token === candidate || token.startsWith(candidate)))?.brand
}

/** A route the details pane shows: the model, and the account it would run on. */
export interface InspectedRoute {
  readonly provider: string
  readonly model: string
}

/** What the details pane does with a change: stage it on a draft, or apply it to the thread at once. */
export type DetailsChange = { readonly kind: 'stage' } | { readonly kind: 'apply'; readonly selection: ModelSelection }

/** A fallback rung named for display: catalog names when the catalog still lists the route, its ids otherwise. */
interface FallbackLabel {
  readonly provider: string
  readonly model: string
  readonly effort: string | undefined
}

export class ModelPickerModel {
  /**
   * Council picker round 1, S1: details of a model the thread does not use are a draft. Inspecting, choosing its account,
   * effort or Fast mode never moves the thread; only "Use ‹model›" does. The thread's own model (on any of its accounts)
   * applies in place.
   */
  static isDraft = (input: { readonly inspected: InspectedRoute | null; readonly current: ModelSelection | null }): boolean =>
    input.inspected !== null && input.current?.model !== input.inspected.model

  /** A change in the details pane: staged on a draft, applied to the thread on its own model. */
  static detailsChange = (input: {
    readonly inspected: InspectedRoute
    readonly current: ModelSelection | null
    readonly change: { readonly provider: string } | { readonly reasoningEffort: string | undefined }
  }): DetailsChange => {
    if (ModelPickerModel.isDraft(input)) return { kind: 'stage' }
    const base = { provider: input.inspected.provider, model: input.inspected.model }
    if ('provider' in input.change) {
      const effort = input.current?.reasoningEffort
      return { kind: 'apply', selection: { ...base, provider: input.change.provider, ...(effort !== undefined && { reasoningEffort: effort }) } }
    }
    const effort = input.change.reasoningEffort
    return { kind: 'apply', selection: { ...base, ...(effort !== undefined && { reasoningEffort: effort }) } }
  }

  /** The selection "Use ‹model›" commits: the staged account and effort, else the model's own default effort. */
  static draftSelection = (input: {
    readonly inspected: InspectedRoute
    readonly model: CatalogModel
    readonly stagedEffort: { readonly value: string | undefined } | null
  }): ModelSelection => {
    const effort = input.stagedEffort === null ? input.model.reasoning?.defaultEffort : input.stagedEffort.value
    return { provider: input.inspected.provider, model: input.inspected.model, ...(effort !== undefined && { reasoningEffort: effort }) }
  }

  /** Council picker C1: a level's segment label (Off, Min, Low, Med, High, XHigh, Max); any other name stays whole. */
  static effortShortLabel = (effort: { readonly id: string; readonly name: string }): string => {
    const key = `${effort.id} ${effort.name}`.toLowerCase()
    const known: readonly (readonly [RegExp, string])[] = [
      [/^(?:off|none)\b/u, 'Off'],
      [/^(?:minimal|min)\b/u, 'Min'],
      [/^low\b/u, 'Low'],
      [/^(?:medium|med)\b/u, 'Med'],
      [/^high\b/u, 'High'],
      [/^(?:xhigh|x-high|extra[ -]high)\b/u, 'XHigh'],
      [/^(?:max|maximum)\b/u, 'Max'],
    ]
    return known.find(([pattern]) => pattern.test(key))?.[1] ?? effort.name
  }

  /** C3: the accounts' quota column heading, named for the window that limits them ("Weekly quota left"). */
  static quotaHeading = (quotas: readonly ModelQuota[]): string | undefined => {
    if (quotas.length === 0) return undefined
    const windows = new Set(quotas.map(quota => quota.label.replace(/\s*limit$/iu, '').trim()))
    const [only] = windows
    return windows.size === 1 && only !== undefined && only.length > 0 ? `${only} quota left` : 'Quota left'
  }

  /**
   * C5: what a key in the search combobox does to the listbox. Up and Down move the active row, Enter uses it, Right (at
   * the end of the query) opens its details; any other key edits the query.
   */
  static listKey = (input: {
    readonly key: string
    readonly active: number
    readonly count: number
    readonly caretAtEnd: boolean
  }): { readonly kind: 'move' | 'use' | 'inspect'; readonly index: number } | { readonly kind: 'none' } => {
    if (input.count === 0) return { kind: 'none' }
    const at = input.active < 0 ? 0 : Math.min(input.active, input.count - 1)
    if (input.key === 'ArrowDown') return { kind: 'move', index: input.active < 0 ? 0 : Math.min(input.count - 1, at + 1) }
    if (input.key === 'ArrowUp') return { kind: 'move', index: Math.max(0, at - 1) }
    if (input.key === 'Enter') return { kind: 'use', index: at }
    if (input.key === 'ArrowRight' && input.caretAtEnd) return { kind: 'inspect', index: at }
    return { kind: 'none' }
  }

  /** C5: the live announcement after a search. */
  static resultAnnouncement = (input: { readonly query: string; readonly count: number }): string =>
    input.count === 0 ? `No models match “${input.query.trim()}”` : `${String(input.count)} model${input.count === 1 ? '' : 's'}`

  /** N4: which empty state the list shows, if any: still loading, a search with no match, or no model at all. */
  static emptyState = (input: {
    readonly status: string
    readonly query: string
    readonly rowCount: number
    readonly catalogEmpty: boolean
  }): 'loading' | 'no-match' | 'no-models' | null => {
    if (input.rowCount > 0) return null
    if (input.status === 'loading') return 'loading'
    if (input.query.trim() !== '' && !input.catalogEmpty) return 'no-match'
    return 'no-models'
  }

  static filterGroups = (groups: readonly ModelGroup[], query: string): readonly ModelGroup[] => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return groups

    return groups
      .map(group => {
        const providerMatches = `${group.name} ${group.id}`.toLowerCase().includes(needle)
        const models = providerMatches
          ? group.models
          : group.models.filter(model => `${model.name} ${model.id} ${model.description ?? ''}`.toLowerCase().includes(needle))
        return { ...group, models }
      })
      .filter(group => group.models.length > 0)
  }

  static selectionForModel = (group: Pick<ModelGroup, 'id'>, model: CatalogModel, current: ModelSelection | null): ModelSelection => {
    const keepsEffort =
      current?.model === model.id &&
      (current.reasoningEffort === undefined || model.reasoning?.efforts.some(effort => effort.id === current.reasoningEffort) === true)
    const reasoningEffort = keepsEffort ? current?.reasoningEffort : model.reasoning?.defaultEffort
    return {
      provider: group.id,
      model: model.id,
      ...(reasoningEffort !== undefined && { reasoningEffort }),
    }
  }

  static selectionForEffort = (current: ModelSelection, reasoningEffort: string | undefined): ModelSelection => ({
    provider: current.provider,
    model: current.model,
    ...(reasoningEffort !== undefined && { reasoningEffort }),
  })

  /** The quota figure the account strip shows: the window that actually limits this account, not the first listed. */
  static quota = (card: AccountsUsage['cards'][number] | undefined): ModelQuota | undefined => {
    if (card === undefined) return undefined
    const binding = UsageOverviewModel.bindingWindow(card)
    if (binding === undefined) return undefined
    return { percent: binding.percentRemaining, label: binding.windowLabel, onReserve: binding.onReserve }
  }

  /**
   * Council picker round 1, N1: one naming everywhere, the kit's (`modelIdentity`, as every subagent surface names a
   * route): read from the model id, so one model reads the same on every account and in one case; an account's
   * `<instance>/` prefix and a vendor prefix that names the same family drop (`google/gemini-3.8-flash` →
   * `gemini-3.8-flash`). The full id stays in the tooltip.
   */
  static displayName = ({ group, model }: { readonly group: Pick<ModelGroup, 'id'>; readonly model: Pick<CatalogModel, 'id' | 'name'> }): string =>
    modelIdentity(group.id, model.id)?.name ?? model.name

  /**
   * Council picker round 1, N2: one short account tag everywhere, the account's badge as AI Accounts and the status bar
   * show it ("CC2", not "#2"): its own badge when it has one, else the initials of its name with any number kept.
   */
  static accountTag = ({ name, badge }: { readonly name: string; readonly badge?: string | undefined }): string => {
    if (badge !== undefined && badge.trim() !== '') return badge.trim()
    const initials = name
      .split(/\s+/u)
      .filter(Boolean)
      .map(part => (/^\d+$/u.test(part) ? part : part[0]))
      .join('')
      .slice(0, 3)
      .toUpperCase()
    return initials === '' ? name : initials
  }

  /** The trigger names the provider (its initials) only when another provider offers the same model name. */
  static triggerLabel = ({
    groups,
    current,
  }: {
    readonly groups: readonly ModelGroup[]
    readonly current: ModelSelection
  }): { readonly model: string; readonly providerTag?: string; readonly title: string } | undefined => {
    const group = groups.find(candidate => candidate.id === current.provider)
    const model = group?.models.find(candidate => candidate.id === current.model)
    if (group === undefined || model === undefined) return undefined
    const name = ModelPickerModel.displayName({ group, model })
    const title = `${group.name} · ${name}`
    // b:4qjm: the chip reads just the model; it names the account only when the thread uses another account than the
    // default one for this model (the first account, in priority order, that offers it). The menu's Account section and
    // the tooltip always name it.
    const fallback = ModelPickerModel.defaultAccountFor({ groups, model: current.model })
    if (fallback === undefined || fallback.id === group.id) return { model: name, title }
    return { model: name, providerTag: ModelPickerModel.accountTag({ name: group.name }), title }
  }

  /** The account a model runs on by default: the first account, in catalog (priority) order, that offers it. */
  static defaultAccountFor = (input: { readonly groups: readonly ModelGroup[]; readonly model: string }): ModelGroup | undefined =>
    input.groups.find(group => group.models.some(model => model.id === input.model))

  /**
   * One list row per model (b:16yr). A route is still model × account; the view groups the routes of one model and one
   * provider kind (same service, several accounts) into a row, so six accounts no longer list every model six times.
   * The row stands for the account a click would use: the thread's account when it offers the model (choosing another
   * model never moves the thread to another account), else the first account in catalog (priority) order. The detail
   * panel chooses among `accounts`. Rows keep catalog order, the thread's own row first.
   */
  static modelRows = (input: {
    readonly groups: readonly ModelGroup[]
    readonly current: ModelSelection | null
  }): readonly {
    readonly key: string
    readonly group: ModelGroup
    readonly model: CatalogModel
    readonly accounts: readonly ModelGroup[]
    readonly active: boolean
  }[] => {
    const rows = new Map<string, { group: ModelGroup; model: CatalogModel; accounts: ModelGroup[] }>()
    for (const group of input.groups) {
      for (const model of group.models) {
        // N4: keyed by the model id alone, which the catalog knows from the first frame; keyed by service, the rows of
        // one model split and then merged once the account profiles arrived, so the list jumped as it opened.
        const key = model.id
        const row = rows.get(key)
        if (row === undefined) rows.set(key, { group, model, accounts: [group] })
        else {
          row.accounts.push(group)
          if (input.current?.provider === group.id && input.current.model === model.id) {
            row.group = group
            row.model = model
          }
        }
      }
    }
    const list = [...rows.entries()].map(([key, row]) => ({
      key,
      ...row,
      active: input.current !== null && row.group.id === input.current.provider && row.model.id === input.current.model,
    }))
    return [...list].sort((left, right) => Number(right.active) - Number(left.active))
  }

  /** The same model on another account, keeping the effort when that account advertises it, else its default. */
  private static selectionOn = (group: ModelGroup, model: CatalogModel, current: ModelSelection): ModelSelection => {
    const keepsEffort = current.reasoningEffort === undefined || model.reasoning?.efforts.some(effort => effort.id === current.reasoningEffort) === true
    const reasoningEffort = keepsEffort ? current.reasoningEffort : model.reasoning?.defaultEffort
    const route: ModelSelection = { provider: group.id, model: model.id }
    return reasoningEffort === undefined ? route : { ...route, reasoningEffort }
  }

  /**
   * The next route, in catalog order, that offers the selected model id: an account rotation that never changes the
   * model. `routes` narrows the rotation; empty means every route. The current effort carries over when the target
   * model advertises it, else the target's own default applies.
   */
  static nextAccountSelection = (input: {
    readonly groups: readonly ModelGroup[]
    readonly current: ModelSelection | null
    readonly routes: readonly string[]
  }): { readonly group: ModelGroup; readonly selection: ModelSelection } | undefined => {
    const current = input.current
    if (current === null) return undefined
    const candidates = input.groups.filter(
      group =>
        group.id === current.provider ||
        ((input.routes.length === 0 || input.routes.includes(group.id)) && group.models.some(model => model.id === current.model)),
    )
    const currentIndex = candidates.findIndex(group => group.id === current.provider)
    const group = [...candidates.slice(currentIndex + 1), ...candidates.slice(0, Math.max(currentIndex, 0))].find(
      candidate => candidate.id !== current.provider,
    )
    const model = group?.models.find(candidate => candidate.id === current.model)
    if (group === undefined || model === undefined) return undefined

    return { group, selection: ModelPickerModel.selectionOn(group, model, current) }
  }

  /** The family mark a row leads with, read from the model id and name rather than the account that serves it. */
  static brandFor = ({ model }: { readonly model: Pick<CatalogModel, 'id' | 'name'> }): BrandKey | undefined => {
    for (const token of `${model.id} ${model.name}`.toLowerCase().split(/[^a-z0-9]+/u)) {
      const brand = token.length === 0 ? undefined : brandOfToken(token)
      if (brand !== undefined) return brand
    }
    return undefined
  }

  /** The family mark the composer chip leads with: the catalog model in use, else its raw id. */
  static triggerBrand = ({ groups, current }: { readonly groups: readonly ModelGroup[]; readonly current: ModelSelection | null }): BrandKey | undefined => {
    if (current === null) return undefined
    const model = groups.find(group => group.id === current.provider)?.models.find(candidate => candidate.id === current.model)
    return ModelPickerModel.brandFor({ model: model ?? { id: current.model, name: current.model } })
  }

  /** The current selection as a fallback rung, keeping its explicit effort only. */
  static fallbackFor = (current: ModelSelection): FallbackRoute =>
    current.reasoningEffort === undefined
      ? { provider: current.provider, model: current.model }
      : { provider: current.provider, model: current.model, reasoningEffort: current.reasoningEffort }

  /** Append a rung unless the chain already holds that provider and model. */
  static withFallback = (chain: readonly FallbackRoute[], route: FallbackRoute): readonly FallbackRoute[] =>
    chain.some(entry => entry.provider === route.provider && entry.model === route.model) ? chain : [...chain, route]

  static withoutFallback = (chain: readonly FallbackRoute[], index: number): readonly FallbackRoute[] => chain.filter((_, position) => position !== index)

  /** Fan-out routes a shift-click collects: bounded like the Host fan-out method, one rung per provider and model. */
  static readonly fanOutLimit = 6

  static toggledFanOut = (chain: readonly ModelSelection[], selection: ModelSelection): readonly ModelSelection[] => {
    const present = chain.some(route => route.provider === selection.provider && route.model === selection.model)
    if (present) return chain.filter(route => route.provider !== selection.provider || route.model !== selection.model)
    if (chain.length >= ModelPickerModel.fanOutLimit) return chain
    return [...chain, selection]
  }

  static isFanOutRoute = (chain: readonly ModelSelection[], selection: Pick<ModelSelection, 'provider' | 'model'>): boolean =>
    chain.some(route => route.provider === selection.provider && route.model === selection.model)

  /** Move one rung to another position, shifting the rungs between; an index outside the chain leaves it as it is. */
  static reorderedFallback = (chain: readonly FallbackRoute[], from: number, to: number): readonly FallbackRoute[] => {
    const moving = chain[from]
    if (moving === undefined || to < 0 || to >= chain.length || from === to) return chain
    const next = chain.filter((_, position) => position !== from)
    next.splice(to, 0, moving)
    return next
  }

  static fallbackLabel = (groups: readonly ModelGroup[], route: FallbackRoute): FallbackLabel => {
    const group = groups.find(candidate => candidate.id === route.provider)
    const model = group?.models.find(candidate => candidate.id === route.model)
    const label: FallbackLabel = {
      provider: group?.name ?? route.provider,
      model: group === undefined || model === undefined ? route.model : ModelPickerModel.displayName({ group, model }),
      effort: undefined,
    }
    const effort = route.reasoningEffort
    if (effort === undefined) return label
    return { ...label, effort: model?.reasoning?.efforts.find(entry => entry.id === effort)?.name ?? effort }
  }

  /**
   * The reasoning effort the composer chip names: the chosen one, else the model's own default. Undefined when neither
   * is known (the provider decides), so the chip shows the model alone instead of saying "Provider default".
   */
  static effortName = (model: CatalogModel, current: ModelSelection | null): string | undefined => {
    const selected = current?.reasoningEffort ?? model.reasoning?.defaultEffort
    if (selected === undefined) return undefined
    return model.reasoning?.efforts.find(effort => effort.id === selected)?.name ?? selected
  }
}
