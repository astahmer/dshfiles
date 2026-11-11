import * as Schema from 'effect/Schema'
import { PREREQUISITES, routeSchema, type CatalogFeature, type FeatureCatalog, type Route } from './catalog-model.js'
import { CURATED_BUNDLES } from './curation.js'
import { PACK_ACTIONS, PackPlan, packPreviewSchema, pluginStateSchema, type PackPreview, type PluginState } from './pack-plan.js'
import { PACKS } from './packs.js'

/** Rail destinations in rail order, then the active thread's regions; `none` sorts last. */
export const DESTINATION_ORDER = [
  'threads',
  'inbox',
  'land',
  'work',
  'agents',
  'observe',
  'knowledge',
  'settings',
  'thread-panel',
  'composer',
  'transcript',
  'none',
] as const

const checklistStateSchema = Schema.Literals(['done', 'todo', 'unknown', 'off'])
export const checklistItemSchema = Schema.Struct({
  id: Schema.Literals(PREREQUISITES),
  title: Schema.String,
  state: checklistStateSchema,
  detail: Schema.String,
  fix: Schema.Struct({ label: Schema.String, route: Schema.NullOr(routeSchema), shellCommand: Schema.NullOr(Schema.String) }),
})
export type ChecklistItem = typeof checklistItemSchema.Type

export const packViewSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  core: Schema.Boolean,
  plugins: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String, state: pluginStateSchema })),
  prerequisites: Schema.Array(Schema.Struct({ id: Schema.Literals(PREREQUISITES), state: checklistStateSchema })),
  keySettings: Schema.Array(Schema.Struct({ label: Schema.String, entryId: Schema.String, fieldPath: Schema.Array(Schema.String) })),
})
export type PackView = typeof packViewSchema.Type

export const featureRowSchema = Schema.Struct({
  key: Schema.String,
  plugin: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  destination: Schema.String,
  currentSurface: Schema.NullOr(Schema.String),
  curated: Schema.Boolean,
  route: Schema.NullOr(routeSchema),
  firstAction: Schema.NullOr(Schema.String),
  doneWhen: Schema.NullOr(Schema.String),
  prerequisites: Schema.Array(Schema.Literals(PREREQUISITES)),
  reachSteps: Schema.Number,
})
export type FeatureRow = typeof featureRowSchema.Type

export const overviewInputSchema = Schema.Struct({
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  destination: Schema.optional(Schema.Literals(DESTINATION_ORDER)),
  curatedOnly: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 200 }))),
  /** Also return exactly what enabling or disabling this pack would change; reading it changes nothing. */
  preview: Schema.optional(Schema.Struct({ pack: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)), action: Schema.Literals(PACK_ACTIONS) })),
})
export type OverviewInput = typeof overviewInputSchema.Type

export const overviewSchema = Schema.Struct({
  checklist: Schema.NullOr(Schema.Array(checklistItemSchema)),
  packs: Schema.Array(packViewSchema),
  features: Schema.Struct({
    total: Schema.Number,
    curatedOnly: Schema.Boolean,
    destinations: Schema.Array(Schema.Struct({ id: Schema.String, count: Schema.Number })),
    rows: Schema.Array(featureRowSchema),
  }),
  preview: Schema.NullOr(packPreviewSchema),
})
export type Overview = typeof overviewSchema.Type

/** What the Host observed; `null` means it could not tell (the service is absent). */
export interface ChecklistFacts {
  readonly account: AccountFacts
  readonly projects: readonly { readonly path: string; readonly vcs: 'jj' | 'git' | null }[] | null
  readonly github: 'signed-in' | 'signed-out' | 'missing' | 'failed' | 'off'
}

/**
 * How the Host knows whether a model can be reached: AI accounts' saved accounts when that plugin serves its API, the
 * registered model provider routes otherwise, `unreadable` when AI accounts did not answer, `null` with no model service.
 */
export type AccountFacts =
  | { readonly source: 'ai-accounts'; readonly saved: number; readonly connected: number }
  | { readonly source: 'providers'; readonly routes: number }
  | { readonly source: 'unreadable' }
  | null

/** What AI accounts' file says, offline: an account counts as connected when it is on, signed in and configured. */
const accountFacts = (accounts: readonly { readonly enabled: boolean; readonly signedIn: boolean; readonly state: string }[]): AccountFacts => ({
  source: 'ai-accounts',
  saved: accounts.length,
  connected: accounts.filter(account => account.enabled && account.signedIn && account.state !== 'disabled' && account.state !== 'unconfigured').length,
})

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`

const accountItem = (facts: AccountFacts): Pick<ChecklistItem, 'state' | 'detail'> => {
  if (facts === null) return { state: 'unknown', detail: 'This Host serves neither AI accounts nor a model service to ask.' }
  if (facts.source === 'unreadable') return { state: 'unknown', detail: 'AI accounts did not answer. Open it to see each account.' }
  if (facts.source === 'providers')
    return facts.routes > 0
      ? {
          state: 'done',
          detail: `${plural(facts.routes, 'model provider')} configured (no account manager installed); whether each holds a working credential is not checked.`,
        }
      : { state: 'todo', detail: 'No model provider is configured, and no account manager is installed.' }
  if (facts.connected > 0) return { state: 'done', detail: `${plural(facts.connected, 'connected account')} in AI accounts.` }
  if (facts.saved > 0) return { state: 'todo', detail: `${plural(facts.saved, 'saved account')}, none connected. Sign one in from AI accounts.` }
  return { state: 'todo', detail: 'No AI account is saved yet.' }
}

const accountsRoute: Route = { panel: 'ai-accounts' }
const projectsRoute: Route = { settings: { section: 'dshfiles-workspace-folder-picker-projects' } }

const checklist = (facts: ChecklistFacts): readonly ChecklistItem[] => {
  const projects = facts.projects
  const repositories = projects?.filter(project => project.vcs !== null) ?? []
  const jj = repositories.filter(project => project.vcs === 'jj').length
  return [
    {
      id: 'account',
      title: 'An AI account is connected',
      ...accountItem(facts.account),
      fix: { label: 'Open AI accounts', route: accountsRoute, shellCommand: null },
    },
    {
      id: 'project',
      title: 'A project is added',
      state: projects === null ? 'unknown' : projects.length > 0 ? 'done' : 'todo',
      detail:
        projects === null
          ? 'This Host serves no workspace registry to ask.'
          : projects.length > 0
            ? `${String(projects.length)} project${projects.length === 1 ? '' : 's'} added.`
            : 'No project folder is registered yet.',
      fix: { label: 'Add a project', route: projectsRoute, shellCommand: null },
    },
    {
      id: 'repository',
      title: 'A project is a jj or git repository',
      state: projects === null ? 'unknown' : repositories.length > 0 ? 'done' : 'todo',
      detail:
        projects === null
          ? 'This Host serves no workspace registry to ask.'
          : repositories.length > 0
            ? `${String(repositories.length)} repositor${repositories.length === 1 ? 'y' : 'ies'} (${String(jj)} jj, ${String(repositories.length - jj)} git).`
            : 'No added project has a .jj or .git folder.',
      fix: { label: 'Set up a repository', route: projectsRoute, shellCommand: 'jj git init --colocate' },
    },
    {
      id: 'github',
      title: 'The GitHub CLI is signed in',
      state: facts.github === 'signed-in' ? 'done' : facts.github === 'off' ? 'off' : facts.github === 'failed' ? 'unknown' : 'todo',
      detail: {
        'signed-in': 'gh is signed in to github.com.',
        'signed-out': 'gh is installed but not signed in to github.com.',
        missing: 'The GitHub CLI (gh) is not installed on this Host.',
        failed: 'gh auth status did not answer in time.',
        off: 'The GitHub check is off in Settings › Onboarding.',
      }[facts.github],
      fix: {
        label: facts.github === 'missing' ? 'Install the GitHub CLI' : 'Sign in with gh',
        route: null,
        shellCommand: facts.github === 'missing' ? 'https://cli.github.com' : 'gh auth login',
      },
    },
  ]
}

const packs = (input: {
  readonly catalog: FeatureCatalog
  readonly states: ReadonlyMap<string, PluginState> | null
  readonly checklist: readonly ChecklistItem[] | null
}): readonly PackView[] =>
  PACKS.map(pack => ({
    id: pack.id,
    title: pack.title,
    summary: pack.summary,
    core: pack.core,
    plugins: pack.plugins.map(name => ({
      name,
      description: input.catalog.plugins.find(plugin => plugin.name === name)?.description ?? '',
      state: input.states === null ? 'unknown' : (input.states.get(name) ?? 'not-installed'),
    })),
    prerequisites: pack.prerequisites.map(id => ({ id, state: input.checklist?.find(item => item.id === id)?.state ?? 'unknown' })),
    keySettings: pack.keySettings,
  }))

const curatedPlugins = new Map(CURATED_BUNDLES.map(bundle => [bundle.plugin, bundle]))

const rowOf = (feature: CatalogFeature): FeatureRow => {
  const bundle = curatedPlugins.get(feature.plugin)
  const curated = feature.onboarding !== null || (bundle !== undefined && feature.destination !== 'none')
  return {
    key: feature.key,
    plugin: feature.plugin,
    title: feature.title,
    summary: feature.summary,
    destination: feature.destination,
    currentSurface: feature.currentSurface,
    curated,
    route: feature.onboarding?.open ?? (feature.destination === 'none' ? undefined : bundle?.open) ?? null,
    firstAction: feature.onboarding?.firstAction ?? null,
    doneWhen: feature.onboarding?.doneWhen ?? null,
    prerequisites: feature.onboarding?.prerequisites ?? [],
    reachSteps: feature.reach.length,
  }
}

const destinationRank = (destination: string): number => {
  const index = DESTINATION_ORDER.findIndex(candidate => candidate === destination)
  return index === -1 ? DESTINATION_ORDER.length : index
}

const DEFAULT_LIMIT = 60

/** Rows for a query: every word must match title, plugin, summary or where it lives; curated-only applies until the user searches. */
const features = (catalog: FeatureCatalog, input: OverviewInput & { readonly curatedDefault: boolean }) => {
  const words = (input.query ?? '')
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(word => word.length > 0)
  const curatedOnly = words.length === 0 && (input.curatedOnly ?? input.curatedDefault)
  const matching = catalog.features
    .map(rowOf)
    .filter(row => !curatedOnly || row.curated)
    .filter(row => {
      const haystack = `${row.title} ${row.plugin} ${row.summary} ${row.currentSurface ?? ''}`.toLocaleLowerCase()
      return words.every(word => haystack.includes(word))
    })
  const counts = new Map<string, number>()
  for (const row of matching) counts.set(row.destination, (counts.get(row.destination) ?? 0) + 1)
  const filtered = input.destination === undefined ? matching : matching.filter(row => row.destination === input.destination)
  const rows = filtered
    .toSorted(
      (left, right) =>
        Number(right.curated) - Number(left.curated) ||
        destinationRank(left.destination) - destinationRank(right.destination) ||
        left.title.localeCompare(right.title),
    )
    .slice(0, input.limit ?? DEFAULT_LIMIT)
  const destinations = [...counts].map(([id, count]) => ({ id, count })).toSorted((left, right) => destinationRank(left.id) - destinationRank(right.id))
  return { total: filtered.length, curatedOnly, destinations, rows }
}

const overview = (input: {
  readonly catalog: FeatureCatalog
  readonly facts: ChecklistFacts | null
  readonly states: ReadonlyMap<string, PluginState> | null
  readonly request: OverviewInput
  readonly curatedDefault: boolean
  readonly preview: PackPreview | null
}): Overview => {
  const items = input.facts === null ? null : checklist(input.facts)
  return {
    checklist: items,
    packs: packs({ catalog: input.catalog, states: input.states, checklist: items }),
    features: features(input.catalog, { ...input.request, curatedDefault: input.curatedDefault }),
    preview: input.preview,
  }
}

const MAX_RENDER = 6_000

/** Compact text for the agent transcript; the structured value carries every row. */
const render = (value: Overview): string => {
  const lines = [
    ...(value.preview === null ? [] : PackPlan.renderPreview(value.preview)),
    '## Setup checklist',
    ...(value.checklist ?? []).map(item => `- [${item.state === 'done' ? 'x' : ' '}] ${item.title} — ${item.detail}`),
    ...(value.checklist === null ? ['(checklist off in Settings › Onboarding)'] : []),
    '## Packs',
    ...value.packs.map(pack => `- ${pack.title}${pack.core ? ' (core)' : ''}: ${pack.plugins.map(plugin => `${plugin.name} ${plugin.state}`).join(', ')}`),
    `## Features (${String(value.features.rows.length)} of ${String(value.features.total)}${value.features.curatedOnly ? ', curated' : ''})`,
    ...value.features.rows.map(row => `- [${row.destination}] ${row.title} (${row.plugin})${row.currentSurface === null ? '' : ` — ${row.currentSurface}`}`),
  ]
  const text = lines.join('\n')
  return text.length <= MAX_RENDER ? text : `${text.slice(0, MAX_RENDER - 1)}…`
}

export class OnboardingOverview {
  static readonly checklist = checklist
  static readonly accountFacts = accountFacts
  static readonly packs = packs
  static readonly features = features
  static readonly overview = overview
  static readonly render = render
  static readonly rowOf = rowOf
}
