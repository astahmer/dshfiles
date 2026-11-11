import * as Schema from 'effect/Schema'
import { PREREQUISITES } from './catalog-model.js'
import { PACKS, type Pack } from './packs.js'

export const PACK_ACTIONS = ['enable', 'disable'] as const
export type PackAction = (typeof PACK_ACTIONS)[number]

const OWNED_SCOPE = '@dshfiles/'
export const PROFILE_INSTALLS_DOCS = 'https://github.com/astahmer/dshfiles/blob/main/docs/profile-installs.md'
export const RESTART_GUIDANCE =
  'Nothing restarts on its own. Restart DSH when it suits you: Restart when idle in the sidebar when DSH runs under the managed launcher, otherwise your own launcher.'

const checklistStateSchema = Schema.Literals(['done', 'todo', 'unknown', 'off'])
export const pluginStateSchema = Schema.Literals(['enabled', 'disabled', 'not-installed', 'unknown'])
export type PluginState = typeof pluginStateSchema.Type

export const packPreviewSchema = Schema.Struct({
  pack: Schema.String,
  title: Schema.String,
  action: Schema.Literals(PACK_ACTIONS),
  /** Why nothing can be planned for this pack here; null when the plan below is complete. */
  unavailable: Schema.NullOr(Schema.String),
  /** Nothing to install, change or report: confirming would do nothing. */
  upToDate: Schema.Boolean,
  /** `automatic` installs through the checkout's dshx; `manual` lists the command to run; `none` installs nothing. */
  installMode: Schema.Literals(['automatic', 'manual', 'none']),
  manualReason: Schema.NullOr(Schema.String),
  install: Schema.Array(Schema.Struct({ plugin: Schema.String, command: Schema.String })),
  change: Schema.Array(Schema.Struct({ plugin: Schema.String, entryIds: Schema.Array(Schema.String) })),
  fine: Schema.Array(Schema.Struct({ plugin: Schema.String, state: pluginStateSchema })),
  kept: Schema.Array(Schema.Struct({ plugin: Schema.String, neededBy: Schema.Array(Schema.String) })),
  blocked: Schema.Array(Schema.Struct({ plugin: Schema.String, reason: Schema.String })),
  prerequisites: Schema.Array(Schema.Struct({ id: Schema.Literals(PREREQUISITES), state: checklistStateSchema })),
  /** `required` when something installs (DSH reads the profile at boot); rows report their own need when applied. */
  restart: Schema.Literals(['required', 'reported-after-apply', 'none']),
  docsUrl: Schema.String,
})
export type PackPreview = typeof packPreviewSchema.Type

export const stepStatusSchema = Schema.Literals(['applied', 'restart-required', 'overridden', 'failed', 'cancelled', 'manual'])
export type StepStatus = typeof stepStatusSchema.Type

export const stepResultSchema = Schema.Struct({
  plugin: Schema.String,
  step: Schema.Literals(['install', 'enable', 'disable']),
  status: stepStatusSchema,
  /** The plugin manager's (or dshx add's) own reason, relayed; never inferred here. */
  restartReason: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
})
export type StepResult = typeof stepResultSchema.Type

export const packSummarySchema = Schema.Struct({
  kind: Schema.Literals(['up-to-date', 'applied', 'restart-required', 'partial', 'failed', 'manual', 'cancelled']),
  message: Schema.String,
  nextActions: Schema.Array(Schema.String),
})
export type PackSummary = typeof packSummarySchema.Type

export const packOutcomeSchema = Schema.Struct({
  preview: packPreviewSchema,
  results: Schema.Array(stepResultSchema),
  summary: packSummarySchema,
})
export type PackOutcome = typeof packOutcomeSchema.Type

/** One Loader entry of an owned plugin, as the plugin manager lists it. */
export interface PluginEntryFact {
  readonly entryId: string
  readonly plugin: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly readOnlyReason: string | null
}

export type Toolchain = { readonly kind: 'automatic' } | { readonly kind: 'manual'; readonly reason: string }

/** The plugin directory an owned module belongs to (`@dshfiles/backlog/x` → `backlog`); null outside the scope. */
const pluginOf = (moduleName: string): string | null =>
  moduleName.startsWith(OWNED_SCOPE) ? (moduleName.slice(OWNED_SCOPE.length).split('/')[0] ?? null) : null

const entriesOf = (
  rows: readonly { readonly entryId: string; readonly moduleName: string; readonly enabled: boolean; readonly readOnlyReason?: string | undefined }[],
) =>
  rows.flatMap((row): PluginEntryFact[] => {
    const plugin = pluginOf(row.moduleName)
    return plugin === null || plugin === ''
      ? []
      : [{ entryId: row.entryId, plugin, moduleName: row.moduleName, enabled: row.enabled, readOnlyReason: row.readOnlyReason ?? null }]
  })

/** A plugin is enabled when any of its entries runs, as Settings › Plugins shows it. */
const statesOf = (entries: readonly PluginEntryFact[]): ReadonlyMap<string, PluginState> => {
  const states = new Map<string, PluginState>()
  for (const entry of entries) if (states.get(entry.plugin) !== 'enabled') states.set(entry.plugin, entry.enabled ? 'enabled' : 'disabled')
  return states
}

/** The entries a pack action targets: the bundle's own row when it has one, else every entry of the plugin. */
const targetEntries = (entries: readonly PluginEntryFact[], plugin: string): readonly PluginEntryFact[] => {
  const own = entries.filter(entry => entry.plugin === plugin)
  const main = own.filter(entry => entry.moduleName === `${OWNED_SCOPE}${plugin}`)
  return main.length > 0 ? main : own
}

/** The command a user runs from the dshfiles checkout; it names the profile, never a path. */
const installCommand = (input: { readonly plugin: string; readonly profile: string | null; readonly homeFromEnv: boolean }): string =>
  [
    'node tooling/dshx/packages/dshx/dist/cli/bin.js add',
    `${OWNED_SCOPE}${input.plugin}`,
    '--profile',
    input.profile ?? '<profile>',
    ...(input.homeFromEnv ? ['--home', '"$DSH_HOME"'] : []),
  ].join(' ')

const emptyPreview = (input: { readonly pack: string; readonly title: string; readonly action: PackAction; readonly unavailable: string }): PackPreview => ({
  pack: input.pack,
  title: input.title,
  action: input.action,
  unavailable: input.unavailable,
  upToDate: false,
  installMode: 'none',
  manualReason: null,
  install: [],
  change: [],
  fine: [],
  kept: [],
  blocked: [],
  prerequisites: [],
  restart: 'none',
  docsUrl: PROFILE_INSTALLS_DOCS,
})

/** A pack counts as on when every plugin it names runs; a disable keeps the plugins such a pack shares. */
const fullyEnabled = (pack: Pack, states: ReadonlyMap<string, PluginState>): boolean => pack.plugins.every(plugin => states.get(plugin) === 'enabled')

export interface PreviewInput {
  readonly pack: string
  readonly action: PackAction
  /** null: this Host serves no plugin manager. */
  readonly entries: readonly PluginEntryFact[] | null
  readonly toolchain: Toolchain
  readonly profile: string | null
  readonly homeFromEnv: boolean
  readonly prerequisites: ReadonlyMap<string, 'done' | 'todo' | 'unknown' | 'off'>
}

/** Exactly what an action would change, computed from the plugin manager's rows; it changes nothing. */
const preview = (input: PreviewInput): PackPreview => {
  const pack = PACKS.find(candidate => candidate.id === input.pack)
  if (pack === undefined)
    return emptyPreview({ ...input, title: input.pack, unavailable: `No pack named ${input.pack}. Packs: ${PACKS.map(each => each.id).join(', ')}.` })
  const base = { pack: pack.id, title: pack.title, action: input.action }
  if (pack.core && input.action === 'disable')
    return emptyPreview({ ...base, unavailable: 'The Core pack stays on: every other pack builds on it. Switch single plugins in Settings › Plugins.' })
  if (input.entries === null)
    return emptyPreview({
      ...base,
      unavailable:
        'This Host serves no plugin manager, so the profile cannot be changed from here. Edit the profile’s cordis.patch.yml by hand, then restart DSH.',
    })
  const entries = input.entries
  const states = statesOf(entries)
  const coreTitle = PACKS.find(candidate => candidate.core)?.title ?? 'Core'
  const corePlugins = new Set(PACKS.filter(candidate => candidate.core).flatMap(candidate => candidate.plugins))
  const install: PackPreview['install'][number][] = []
  const change: PackPreview['change'][number][] = []
  const fine: PackPreview['fine'][number][] = []
  const kept: PackPreview['kept'][number][] = []
  const blocked: PackPreview['blocked'][number][] = []
  for (const plugin of pack.plugins) {
    const state = states.get(plugin) ?? 'not-installed'
    const targets = targetEntries(entries, plugin)
    if (input.action === 'enable') {
      if (state === 'not-installed') {
        install.push({ plugin, command: installCommand({ plugin, profile: input.profile, homeFromEnv: input.homeFromEnv }) })
        continue
      }
      const off = targets.filter(entry => !entry.enabled)
      const readOnly = off.filter(entry => entry.readOnlyReason !== null)
      if (readOnly.length > 0) blocked.push({ plugin, reason: `read-only (${readOnly.map(entry => entry.readOnlyReason ?? '').join(', ')})` })
      const writable = off.filter(entry => entry.readOnlyReason === null)
      if (writable.length > 0) change.push({ plugin, entryIds: writable.map(entry => entry.entryId) })
      else if (readOnly.length === 0) fine.push({ plugin, state })
      continue
    }
    if (state !== 'enabled') {
      fine.push({ plugin, state })
      continue
    }
    const neededBy = [
      ...(!pack.core && corePlugins.has(plugin) ? [coreTitle] : []),
      ...PACKS.filter(other => !other.core && other.id !== pack.id && other.plugins.includes(plugin) && fullyEnabled(other, states)).map(other => other.title),
    ]
    if (neededBy.length > 0) {
      kept.push({ plugin, neededBy })
      continue
    }
    const on = targets.filter(entry => entry.enabled)
    const readOnly = on.filter(entry => entry.readOnlyReason !== null)
    if (readOnly.length > 0) blocked.push({ plugin, reason: `read-only (${readOnly.map(entry => entry.readOnlyReason ?? '').join(', ')})` })
    const writable = on.filter(entry => entry.readOnlyReason === null)
    if (writable.length > 0) change.push({ plugin, entryIds: writable.map(entry => entry.entryId) })
  }
  const installMode = install.length === 0 ? 'none' : input.toolchain.kind
  return {
    ...base,
    unavailable: null,
    upToDate: install.length === 0 && change.length === 0 && blocked.length === 0,
    installMode,
    manualReason: installMode === 'manual' && input.toolchain.kind === 'manual' ? input.toolchain.reason : null,
    install,
    change,
    fine,
    kept,
    blocked,
    prerequisites: pack.prerequisites.map(id => ({ id, state: input.prerequisites.get(id) ?? 'unknown' })),
    restart: install.length > 0 ? 'required' : change.length > 0 ? 'reported-after-apply' : 'none',
    docsUrl: PROFILE_INSTALLS_DOCS,
  }
}

/** The plugins an apply works through, in order: row changes first (they apply live), then installs. */
const stepsOf = (value: PackPreview, only?: readonly string[]): readonly string[] => {
  const plugins = [...value.change.map(step => step.plugin), ...value.install.map(step => step.plugin)]
  return only === undefined ? plugins : plugins.filter(plugin => only.includes(plugin))
}

const SUCCEEDED: ReadonlySet<StepStatus> = new Set(['applied', 'restart-required'])

const nextActionOf = (result: StepResult, value: PackPreview): string | null => {
  const command = value.install.find(step => step.plugin === result.plugin)?.command
  if (result.status === 'manual' || (result.status === 'failed' && result.step === 'install'))
    return `Install ${result.plugin} from the dshfiles checkout: ${command ?? ''} (see ${value.docsUrl}).`
  if (result.status === 'overridden')
    return `A higher-priority profile layer keeps ${result.plugin} as it was: edit that layer’s row in cordis.patch.yml, or switch it in Settings › Plugins.`
  if (result.status === 'failed') return `${result.plugin} was not changed${result.detail === null ? '' : ` (${result.detail})`}: try it in Settings › Plugins.`
  return null
}

/** One verdict for a set of step results; a partial run never reads as success. */
const summarize = (input: { readonly preview: PackPreview; readonly results: readonly StepResult[] }): PackSummary => {
  const results = input.results
  if (input.preview.unavailable !== null) return { kind: 'failed', message: input.preview.unavailable, nextActions: [] }
  if (results.length === 0)
    return input.preview.upToDate
      ? { kind: 'up-to-date', message: `${input.preview.title} is up to date: nothing to change.`, nextActions: [] }
      : { kind: 'failed', message: 'Nothing was changed.', nextActions: input.preview.blocked.map(row => `${row.plugin} is ${row.reason}.`) }
  const succeeded = results.filter(result => SUCCEEDED.has(result.status))
  const missed = results.filter(result => !SUCCEEDED.has(result.status))
  const installed = results.filter(result => result.step === 'install' && SUCCEEDED.has(result.status)).map(result => result.plugin)
  const notInstalled = results.filter(result => result.step === 'install' && !SUCCEEDED.has(result.status)).map(result => result.plugin)
  const restart = succeeded.some(result => result.status === 'restart-required')
  const nextActions = [
    ...missed.flatMap(result => {
      const action = nextActionOf(result, input.preview)
      return action === null ? [] : [action]
    }),
    ...(missed.some(result => result.status === 'cancelled')
      ? [`Press ${input.preview.action === 'enable' ? 'Enable' : 'Disable'} pack again to finish the rest.`]
      : []),
    ...(restart ? [RESTART_GUIDANCE] : []),
  ]
  const installedNow = [
    ...(installed.length === 0 ? [] : [`Installed now: ${installed.join(', ')}.`]),
    ...(notInstalled.length === 0 ? [] : [`Not installed: ${notInstalled.join(', ')}.`]),
  ].join(' ')
  const verb = input.preview.action === 'enable' ? 'enabled' : 'disabled'
  const changed = succeeded.map(result => result.plugin).join(', ')
  const suffix = installedNow === '' ? '' : ` ${installedNow}`
  if (succeeded.length > 0 && missed.length > 0)
    return {
      kind: 'partial',
      message: `Partly done: ${String(succeeded.length)} of ${String(results.length)} plugins changed (${changed}); ${missed.map(result => `${result.plugin} ${result.status}`).join(', ')}. Nothing was rolled back.${suffix}`,
      nextActions,
    }
  if (succeeded.length === 0) {
    const kind = missed.every(result => result.status === 'manual') ? 'manual' : missed.every(result => result.status === 'cancelled') ? 'cancelled' : 'failed'
    const message = {
      manual: 'Nothing was installed here: this Host cannot run the dshfiles toolchain. Run the commands below.',
      cancelled: 'Cancelled before anything changed.',
      failed: `Nothing changed: ${missed.map(result => `${result.plugin} ${result.status}${result.detail === null ? '' : ` (${result.detail})`}`).join('; ')}.`,
    }[kind]
    return { kind, message: `${message}${suffix}`, nextActions }
  }
  return {
    kind: restart ? 'restart-required' : 'applied',
    message: restart ? `Saved: ${changed}. It takes effect after a restart of DSH.${suffix}` : `Done: ${changed} ${verb} in the running DSH.${suffix}`,
    nextActions,
  }
}

const RENDER_LIMIT = 4_000

const renderPreview = (value: PackPreview): string[] => {
  if (value.unavailable !== null) return [`${value.title}: ${value.unavailable}`]
  return [
    `## ${value.action === 'enable' ? 'Enable' : 'Disable'} ${value.title}${value.upToDate ? ' — up to date' : ''}`,
    ...value.install.map(step => `- install ${step.plugin}${value.installMode === 'manual' ? ` (manual: ${step.command})` : ''}`),
    ...value.change.map(step => `- ${value.action} ${step.plugin}`),
    ...value.fine.map(step => `- already fine: ${step.plugin} (${step.state})`),
    ...value.kept.map(step => `- kept on: ${step.plugin} (needed by ${step.neededBy.join(', ')})`),
    ...value.blocked.map(step => `- cannot change: ${step.plugin} (${step.reason})`),
    ...(value.prerequisites.length === 0 ? [] : [`Needs: ${value.prerequisites.map(item => `${item.id} ${item.state}`).join(', ')}`]),
    `Restart: ${{ required: 'needed for installs (DSH reads the profile at boot)', 'reported-after-apply': 'reported by the plugin manager per row', none: 'none' }[value.restart]}`,
    ...(value.manualReason === null ? [] : [`Manual install: ${value.manualReason} Docs: ${value.docsUrl}`]),
  ]
}

const renderOutcome = (value: PackOutcome): string => {
  const text = [
    ...renderPreview(value.preview),
    ...value.results.map(
      result =>
        `- ${result.step} ${result.plugin}: ${result.status}${result.restartReason === null ? '' : ` (restart reason: ${result.restartReason})`}${result.detail === null ? '' : ` — ${result.detail}`}`,
    ),
    `Outcome: ${value.summary.kind}. ${value.summary.message}`,
    ...value.summary.nextActions.map(action => `Next: ${action}`),
  ].join('\n')
  return text.length <= RENDER_LIMIT ? text : `${text.slice(0, RENDER_LIMIT - 1)}…`
}

export class PackPlan {
  static readonly entriesOf = entriesOf
  static readonly statesOf = statesOf
  static readonly preview = preview
  static readonly stepsOf = stepsOf
  static readonly summarize = summarize
  static readonly renderPreview = renderPreview
  static readonly renderOutcome = renderOutcome
}
