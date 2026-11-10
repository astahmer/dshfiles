import type {} from '@deepseek-ai/dsh-plugin-manager'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import type { PluginChange, PluginEntry } from './shell-api.js'

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

export class PluginManagerFailed extends Schema.TaggedError<PluginManagerFailed>()(
  'PluginManagerFailed',
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'plugin-manager-failed' },
) {
  override get message(): string {
    return `${this.reason} Settings › Plugins shows the same entries; the profile’s cordis.patch.yml can be edited by hand.`
  }
}

const MAX_REASON = 300

/** The plugin-manager surface these controls read; `PluginManager` satisfies it with its branded entry ids. */
export interface PluginManagerSurface<Id extends string> {
  listPlugins(): Promise<readonly PluginInfoLike<Id>[]>
  setPluginEnabled(id: Id, enabled: boolean): Promise<unknown>
}

export interface PluginInfoLike<Id extends string> {
  readonly entryId: Id
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: string | null
  readonly readOnlyReason?: string
}

const changeResultSchema = Schema.Struct({
  changed: Schema.Boolean,
  application: Schema.String,
  restartReason: Schema.optionalKey(Schema.String),
  enabled: Schema.optionalKey(Schema.Boolean),
  error: Schema.optionalKey(Schema.Struct({ code: Schema.String, diagnostic: Schema.optionalKey(Schema.String) })),
  warnings: Schema.optionalKey(Schema.Array(Schema.String)),
})

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause)).slice(0, MAX_REASON)

export class PluginControls extends Context.Service<
  PluginControls,
  {
    readonly list: Effect.Effect<readonly PluginEntry[], PluginManagerMissing | PluginManagerFailed>
    readonly setEnabled: (input: {
      readonly entryId: string
      readonly enabled: boolean
    }) => Effect.Effect<PluginChange, PluginManagerMissing | PluginManagerFailed | PluginEntryUnknown>
  }
>()('@dshfiles/settings-shell/PluginControls') {
  static readonly layerFrom = <Id extends string>(manager: () => PluginManagerSurface<Id> | undefined) =>
    Layer.succeed(
      PluginControls,
      (() => {
        const current = Effect.suspend(() => {
          const found = manager()
          return found === undefined ? Effect.fail(new PluginManagerMissing({})) : Effect.succeed(found)
        })
        const entries = Effect.flatMap(current, found =>
          Effect.tryPromise({ try: () => found.listPlugins(), catch: cause => new PluginManagerFailed({ reason: reasonOf(cause), cause }) }),
        )
        const list = Effect.map(entries, rows =>
          rows.map(row => ({
            entryId: row.entryId,
            moduleName: row.moduleName,
            enabled: row.enabled,
            phase: row.fiberPhase,
            ...(row.readOnlyReason === undefined ? {} : { readOnlyReason: row.readOnlyReason }),
          })),
        ).pipe(Effect.withSpan('settings-shell plugin inventory read'))
        const setEnabled = Effect.fn('settings-shell plugin enablement write')(function* (input: { readonly entryId: string; readonly enabled: boolean }) {
          const found = yield* current
          const rows = yield* entries
          const row = rows.find(candidate => candidate.entryId === input.entryId)
          if (row === undefined) return yield* Effect.fail(new PluginEntryUnknown({ entryId: input.entryId }))
          const raw = yield* Effect.tryPromise({
            try: () => found.setPluginEnabled(row.entryId, input.enabled),
            catch: cause => new PluginManagerFailed({ reason: reasonOf(cause), cause }),
          })
          const result = Option.getOrUndefined(Schema.decodeUnknownOption(changeResultSchema)(raw))
          if (result === undefined) return yield* Effect.fail(new PluginManagerFailed({ reason: 'The plugin manager answered in an unknown shape.' }))
          return {
            entryId: input.entryId,
            changed: result.changed,
            enabled: result.enabled ?? null,
            application: result.application,
            ...(result.restartReason === undefined ? {} : { restartReason: result.restartReason }),
            ...(result.error === undefined
              ? {}
              : { error: [result.error.code, result.error.diagnostic].filter(part => part !== undefined).join(': ').slice(0, MAX_REASON) }),
            warnings: (result.warnings ?? []).slice(0, 50),
          }
        })
        return PluginControls.of({ list, setEnabled })
      })(),
    )

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const host = yield* HostContext
      return PluginControls.layerFrom(() => host.ctx.get('pluginManager'))
    }),
  )
}
