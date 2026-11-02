import type {} from '@deepseek-ai/dsh-settings'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import type { settingsPatchEffectSchema } from './shell-api.js'

export type SettingsPatch = typeof settingsPatchEffectSchema.Type

/** What these tools read from one settings namespace; `SettingsDescriptor` satisfies it. */
export interface SettingsRow {
  readonly ns: string
  readonly revision: number
  readonly autoGenerate: boolean
  readonly secrets?: readonly unknown[]
  readonly value: unknown
}

/** A field reset. Path mutation exists so a caller holding a redacted view never restates the section. */
export interface SettingsUnsetOp {
  readonly op: 'unset'
  readonly path: readonly string[]
}

/** The Host settings surface; `SettingsForms` satisfies it. */
export interface SettingsSurface {
  readonly writable: boolean
  describe(options?: { readonly redactSecrets?: boolean }): readonly SettingsRow[]
  update(ns: string, patch: SettingsPatch, expectedRevision?: number): Promise<void>
  mutate(ns: string, ops: readonly SettingsUnsetOp[], expectedRevision?: number): Promise<void>
}

/** This Host serves no settings service. */
export class SettingsServiceMissing extends Schema.TaggedError<SettingsServiceMissing>()(
  'SettingsServiceMissing',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'settings-unavailable' },
) {
  override get message(): string {
    return 'This Host serves no settings service.'
  }
}

/** The Host refused a settings write; the cause carries its code and message. */
export class NativeSettingsWriteFailed extends Schema.TaggedError<NativeSettingsWriteFailed>()('NativeSettingsWriteFailed', {
  namespace: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Could not write settings namespace ${this.namespace}.`
  }
}

export interface SettingsForms {
  readonly writable: boolean
  readonly describe: Effect.Effect<readonly SettingsRow[]>
  readonly update: (input: {
    readonly namespace: string
    readonly patch: SettingsPatch
    readonly expectedRevision: number
  }) => Effect.Effect<void, NativeSettingsWriteFailed>
  readonly unset: (input: {
    readonly namespace: string
    readonly path: readonly string[]
    readonly expectedRevision: number
  }) => Effect.Effect<void, NativeSettingsWriteFailed>
}

const settingsProviderSchema = Schema.Struct({ documentPath: Schema.String })

const formsOf = (surface: SettingsSurface): SettingsForms => ({
  writable: surface.writable,
  describe: Effect.sync(() => surface.describe({ redactSecrets: true })),
  update: input =>
    Effect.tryPromise({
      try: () => surface.update(input.namespace, input.patch, input.expectedRevision),
      catch: cause => new NativeSettingsWriteFailed({ namespace: input.namespace, cause }),
    }),
  unset: input =>
    Effect.tryPromise({
      try: () => surface.mutate(input.namespace, [{ op: 'unset', path: input.path }], input.expectedRevision),
      catch: cause => new NativeSettingsWriteFailed({ namespace: input.namespace, cause }),
    }),
})

/** The Host settings forms, read at each call because the settings service may load after this plugin. */
export class NativeSettings extends Context.Service<
  NativeSettings,
  {
    readonly forms: Effect.Effect<SettingsForms, SettingsServiceMissing>
    /** Where the forms store the settings document, when the Host settings service names one. */
    readonly documentPath: Effect.Effect<Option.Option<string>>
  }
>()('@dshfiles/settings-shell/NativeSettings') {
  /** Serve a settings surface the caller holds, such as a test's stand-in for the Host settings forms. */
  static readonly layerFrom = (surface: () => SettingsSurface | undefined) =>
    Layer.succeed(
      NativeSettings,
      NativeSettings.of({
        forms: Effect.suspend(() => {
          const current = surface()
          return current === undefined ? Effect.fail(new SettingsServiceMissing({})) : Effect.succeed(formsOf(current))
        }),
        documentPath: Effect.sync(() => Option.map(Schema.decodeUnknownOption(settingsProviderSchema)(surface()), provider => provider.documentPath)),
      }),
    )

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const host = yield* HostContext
      return NativeSettings.layerFrom(() => host.ctx.get('settings'))
    }),
  )
}
