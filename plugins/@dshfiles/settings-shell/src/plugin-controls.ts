import type {} from '@deepseek-ai/dsh-plugin-manager'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, FileSystem, Layer, Option, Ref, Schema } from 'effect'
import { NativeSettings } from './native-settings-promise.js'
import { MAX_REASON, PluginManagerFailed, pluginManagerCalls, type BundleInfoLike, type PluginManagerSurface } from './plugin-manager-promise.js'
import { rowIdOf, type PluginBundle, type PluginBundleChange, type PluginBundleOrigin, type PluginChange, type PluginEntry } from './shell-api.js'

/**
 * The profile's Loader entries and their enablement, through the plugin manager that owns the profile patch. It persists
 * the change and reports, independently, whether the running Host applied it or waits for a restart; this service only
 * relays that verdict and never claims a runtime state the manager did not report.
 */

/** This Host composes no plugin manager, so the profile cannot be changed from here. */
export class PluginManagerMissing extends Schema.TaggedError<PluginManagerMissing>()(
  'PluginManagerMissing',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'plugin-manager-unavailable' },
) {
  override get message(): string {
    return 'This Host serves no plugin manager. Change the profile’s cordis.patch.yml by hand, then restart DSH.'
  }
}

export class PluginEntryUnknown extends Schema.TaggedError<PluginEntryUnknown>()(
  'PluginEntryUnknown',
  { entryId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'plugin-entry-unknown' },
) {
  override get message(): string {
    return `No plugin entry ${this.entryId}. List the entries with plugin_inventory and use one of their entryId values.`
  }
}

export class PluginBundleUnknown extends Schema.TaggedError<PluginBundleUnknown>()(
  'PluginBundleUnknown',
  { name: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'plugin-bundle-unknown' },
) {
  override get message(): string {
    return `No bundle ${this.name} in this profile.`
  }
}

const bundleOriginOf = (bundle: BundleInfoLike): PluginBundleOrigin => {
  if (bundle.name.startsWith('@dshfiles/')) return 'dshfiles'
  if (bundle.official === true || bundle.name.startsWith('@deepseek-ai/')) return 'dsh'
  return 'community'
}

const bundlePendingRestart = (input: {
  readonly target: boolean | undefined
  readonly running: boolean
  readonly hasRows: boolean
}): PluginBundle['pendingRestart'] => {
  if (input.target === undefined) return null
  if (input.target === input.running && input.hasRows) return null
  return input.target ? 'enable' : 'disable'
}

const SEED_START = '# BEGIN NIX-MANAGED DSH PLUGINS'
const SEED_END = '# END NIX-MANAGED DSH PLUGINS'
const TOP_LEVEL_ID = /^- id:\s*['"]?([^'"\s#]+)/u

/**
 * Entry ids whose last top-level override in the profile patch sits inside the seed's marked region. The plugin manager
 * edits that last override in place, and `pnpm profile:sync` restores the region from the seed, so a change to one of
 * these rows does not survive the next sync. Rows overridden after the region, or not at all, get an appended override
 * outside it, which the sync keeps.
 */
export const seedRegionEntries = (patch: string): ReadonlySet<string> => {
  const last = new Map<string, boolean>()
  let inside = false
  for (const line of patch.split('\n')) {
    if (line.startsWith(SEED_START)) inside = true
    else if (line.startsWith(SEED_END)) inside = false
    const id = TOP_LEVEL_ID.exec(line)?.[1]
    if (id !== undefined) last.set(id, inside)
  }
  return new Set([...last].filter(([, seeded]) => seeded).map(([id]) => id))
}

const RUNNING_PHASES: ReadonlySet<string | null> = new Set(['pending', 'loading', 'active'])

export class PluginControls extends Context.Service<
  PluginControls,
  {
    readonly list: Effect.Effect<readonly PluginEntry[], PluginManagerMissing | PluginManagerFailed>
    readonly setEnabled: (input: {
      readonly entryId: string
      readonly enabled: boolean
    }) => Effect.Effect<PluginChange, PluginManagerMissing | PluginManagerFailed | PluginEntryUnknown>
    readonly listBundles: Effect.Effect<readonly PluginBundle[], PluginManagerMissing | PluginManagerFailed>
    readonly setBundleEnabled: (input: {
      readonly name: string
      readonly enabled: boolean
    }) => Effect.Effect<PluginBundleChange, PluginManagerMissing | PluginManagerFailed | PluginBundleUnknown>
  }
>()('@dshfiles/settings-shell/PluginControls') {
  static readonly layerFrom = <Id extends string>(
    manager: () => PluginManagerSurface<Id> | undefined,
    profilePatch: Effect.Effect<Option.Option<string>> = Effect.succeedNone,
  ) =>
    Layer.effect(
      PluginControls,
      Effect.gen(function* () {
        // What a change this Host relayed waits for: the next start enables or disables the entry. A restart clears it.
        const awaitingRestart = yield* Ref.make(new Map<string, boolean>())
        const awaitingBundleRestart = yield* Ref.make(new Map<string, boolean>())
        // Bundle records only name owners: when the manager cannot read them, the entries still list, without one.
        const bundles = (found: PluginManagerSurface<Id>): Effect.Effect<readonly BundleInfoLike[]> =>
          pluginManagerCalls(found).listBundles.pipe(Effect.orElseSucceed(() => []))
        const current = Effect.suspend(() => {
          const found = manager()
          return found === undefined ? Effect.fail(new PluginManagerMissing({})) : Effect.succeed(found)
        })
        const entries = Effect.flatMap(current, found => pluginManagerCalls(found).listPlugins)
        const list = Effect.gen(function* () {
          const found = yield* current
          const rows = yield* entries
          const bundleRows = yield* bundles(found)
          const seeded = Option.match(yield* profilePatch, { onNone: () => new Set<string>(), onSome: seedRegionEntries })
          const awaiting = yield* Ref.get(awaitingRestart)
          return rows.map((row): PluginEntry => {
            const running = RUNNING_PHASES.has(row.fiberPhase)
            const target = awaiting.get(row.entryId) ?? (!row.enabled && running ? false : undefined)
            const rowId = rowIdOf(row.entryId)
            return {
              entryId: row.entryId,
              moduleName: row.moduleName,
              enabled: row.enabled,
              phase: row.fiberPhase,
              readOnlyReason: row.readOnlyReason ?? null,
              bundle: bundleRows.find(bundle => bundle.rows.some(declared => (declared.entryId ?? declared.rowId) === row.entryId))?.name ?? null,
              configuredBy: bundleRows.filter(bundle => bundle.overrides.includes(rowId)).map(bundle => bundle.name),
              pendingRestart: target === undefined || target === running ? null : target ? 'enable' : 'disable',
              seedRegion: seeded.has(rowId),
            }
          })
        }).pipe(Effect.withSpan('settings-shell plugin inventory read'))
        const setEnabled = Effect.fn('settings-shell plugin enablement write')(function* (input: { readonly entryId: string; readonly enabled: boolean }) {
          const found = yield* current
          const rows = yield* entries
          const row = rows.find(candidate => candidate.entryId === input.entryId)
          if (row === undefined) return yield* Effect.fail(new PluginEntryUnknown({ entryId: input.entryId }))
          const result = yield* pluginManagerCalls(found).setPluginEnabled(row.entryId, input.enabled)
          const change: PluginChange = {
            entryId: input.entryId,
            changed: result.changed,
            enabled: result.enabled ?? null,
            application: result.application,
            restartReason: result.restartReason ?? null,
            error:
              result.error === undefined
                ? null
                : [result.error.code, result.error.diagnostic]
                    .filter(part => part !== undefined)
                    .join(': ')
                    .slice(0, MAX_REASON),
            warnings: (result.warnings ?? []).slice(0, 50),
          }
          if (result.application === 'restart-required') yield* Ref.update(awaitingRestart, map => new Map(map).set(input.entryId, input.enabled))
          if (result.application === 'applied') yield* Ref.update(awaitingRestart, map => new Map([...map].filter(([id]) => id !== input.entryId)))
          return change
        })
        const listBundles = Effect.gen(function* () {
          const found = yield* current
          const bundleRows = yield* pluginManagerCalls(found).listBundles
          const pluginRows = yield* pluginManagerCalls(found).listPlugins.pipe(Effect.orElseSucceed(() => []))
          const runningIds = new Set<string>(pluginRows.filter(row => RUNNING_PHASES.has(row.fiberPhase)).map(row => row.entryId))
          const awaiting = yield* Ref.get(awaitingBundleRestart)
          return bundleRows
            .map((bundle): PluginBundle => {
              const activeRowCount = bundle.rows.filter(row => row.entryId !== undefined && runningIds.has(row.entryId)).length
              const target = awaiting.get(bundle.name)
              const running = activeRowCount > 0
              const pendingRestart = bundlePendingRestart({ target, running, hasRows: bundle.rows.length > 0 })
              return {
                name: bundle.name,
                origin: bundleOriginOf(bundle),
                official: bundle.official === true,
                title: bundle.meta?.title ?? null,
                description: bundle.meta?.description ?? null,
                packageDescription: bundle.description ?? null,
                version: bundle.version ?? null,
                enabled: bundle.enabled ?? false,
                installed: bundle.installed ?? bundle.availability !== 'missing',
                availability: bundle.availability ?? 'profile',
                readOnlyReason: bundle.readOnlyReason ?? null,
                pendingRestart,
                rowIds: bundle.rows.map(row => row.rowId).slice(0, 200),
                activeRowCount,
              }
            })
            .sort((left, right) => left.name.localeCompare(right.name))
        }).pipe(Effect.withSpan('settings-shell bundle inventory read'))
        const setBundleEnabled = Effect.fn('settings-shell bundle enablement write')(function* (input: { readonly name: string; readonly enabled: boolean }) {
          const found = yield* current
          const bundleRows = yield* pluginManagerCalls(found).listBundles
          const bundle = bundleRows.find(candidate => candidate.name === input.name)
          if (bundle === undefined) return yield* Effect.fail(new PluginBundleUnknown({ name: input.name }))
          const result = yield* pluginManagerCalls(found).setBundleEnabled(bundle.name, input.enabled)
          const change: PluginBundleChange = {
            name: input.name,
            changed: result.changed,
            enabled: result.enabled ?? null,
            application: result.application,
            restartReason: result.restartReason ?? null,
            error:
              result.error === undefined
                ? null
                : [result.error.code, result.error.diagnostic]
                    .filter(part => part !== undefined)
                    .join(': ')
                    .slice(0, MAX_REASON),
            warnings: (result.warnings ?? []).slice(0, 50),
          }
          if (result.application === 'restart-required') yield* Ref.update(awaitingBundleRestart, map => new Map(map).set(input.name, input.enabled))
          if (result.application === 'applied') yield* Ref.update(awaitingBundleRestart, map => new Map([...map].filter(([id]) => id !== input.name)))
          return change
        })
        return PluginControls.of({ list, setEnabled, listBundles, setBundleEnabled })
      }),
    )

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const host = yield* HostContext
      const native = yield* NativeSettings
      const fs = yield* FileSystem.FileSystem
      const profilePatch = Effect.flatMap(native.documentPath, path =>
        Option.match(path, { onNone: () => Effect.succeedNone, onSome: file => Effect.option(fs.readFileString(file)) }),
      )
      return PluginControls.layerFrom(() => host.ctx.get('pluginManager'), profilePatch)
    }),
  )
}
