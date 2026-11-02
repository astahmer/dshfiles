import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import {
  NativeSettings,
  type NativeSettingsWriteFailed,
  type SettingsForms,
  type SettingsPatch,
  type SettingsRow,
  type SettingsServiceMissing,
} from './native-settings-promise.js'
import { SettingsSearch, type SectionEntryRow } from './settings-search.js'

/** One namespace section is far larger than any settings form; keep the model-facing JSON bounded. */
const MAX_VALUE_BYTES = 64 * 1024
const MAX_NAMES_IN_ERROR = 8
const MAX_MESSAGE = 300
const MAX_LISTED_ENTRIES = 50

export class SettingsNamespaceUnknown extends Schema.TaggedError<SettingsNamespaceUnknown>()(
  'SettingsNamespaceUnknown',
  { namespace: Schema.String, known: Schema.Array(Schema.String), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'settings-namespace-unknown' },
) {
  override get message(): string {
    return this.known.length === 0
      ? `No settings namespace named ${this.namespace}; this profile serves none.`
      : `No settings namespace named ${this.namespace}. Known namespaces include ${this.known.join(', ')}.`
  }
}

export class SettingsReadOnly extends Schema.TaggedError<SettingsReadOnly>()(
  'SettingsReadOnly',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'settings-read-only' },
) {
  override get message(): string {
    return 'The active profile does not accept settings edits.'
  }
}

export class SettingsWriteConflict extends Schema.TaggedError<SettingsWriteConflict>()(
  'SettingsWriteConflict',
  { namespace: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'settings-conflict' },
) {
  override get message(): string {
    return `${this.namespace} changed since it was read; read it again with settings_list and retry.`
  }
}

/** The Host refused the write, usually because the patch does not match the namespace schema. */
export class SettingsWriteRejected extends Schema.TaggedError<SettingsWriteRejected>()(
  'SettingsWriteRejected',
  { namespace: Schema.String, reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'settings-rejected' },
) {
  override get message(): string {
    return this.reason
  }
}

export type SettingsReadFailure = SettingsServiceMissing | SettingsNamespaceUnknown
export type SettingsWriteFailure = SettingsReadFailure | SettingsReadOnly | SettingsWriteConflict | SettingsWriteRejected

export interface SettingsListInput {
  readonly namespace?: string | undefined
  readonly query?: string | undefined
}

export interface SettingsNamespaceRow {
  readonly namespace: string
  readonly revision: number
  readonly autoGenerate: boolean
  readonly secretFields: number
  readonly value?: string
  readonly valueTooLarge?: boolean
}

const failureSchema = Schema.Struct({ code: Schema.optionalKey(Schema.String), message: Schema.optionalKey(Schema.String) })

const classifyWriteFailure = (error: NativeSettingsWriteFailed) => {
  const failure = Option.getOrUndefined(Schema.decodeUnknownOption(failureSchema)(error.cause))
  if (failure?.code === 'SETTINGS_CONFLICT') return new SettingsWriteConflict({ namespace: error.namespace, cause: error })
  return new SettingsWriteRejected({
    namespace: error.namespace,
    reason: (failure?.message ?? `Could not write settings namespace ${error.namespace}.`).slice(0, MAX_MESSAGE),
    cause: error,
  })
}

const jsonBytes = (text: string): number => new TextEncoder().encode(text).length

const listedRow = (descriptor: SettingsRow, withValue: boolean): SettingsNamespaceRow => {
  const row: SettingsNamespaceRow = {
    namespace: descriptor.ns,
    revision: descriptor.revision,
    autoGenerate: descriptor.autoGenerate,
    secretFields: descriptor.secrets?.length ?? 0,
  }
  if (!withValue) return row
  const text = JSON.stringify(descriptor.value)
  if (text === undefined) return row
  if (jsonBytes(text) > MAX_VALUE_BYTES) return { ...row, valueTooLarge: true }
  return { ...row, value: text }
}

const requireNamespace = (forms: SettingsForms, namespace: string) =>
  Effect.flatMap(forms.describe, descriptors => {
    const found = descriptors.find(descriptor => descriptor.ns === namespace)
    if (found !== undefined) return Effect.succeed(found)
    return Effect.fail(new SettingsNamespaceUnknown({ namespace, known: descriptors.slice(0, MAX_NAMES_IN_ERROR).map(descriptor => descriptor.ns) }))
  })

const writableForms = (forms: SettingsForms) => (forms.writable ? Effect.succeed(forms) : Effect.fail(new SettingsReadOnly({})))

/** Read, merge and reset Host settings namespaces for agents, and search the controls the browser Settings sections published. */
export class SettingsTools extends Context.Service<
  SettingsTools,
  {
    readonly list: (
      input: SettingsListInput,
    ) => Effect.Effect<{ readonly writable: boolean; readonly namespaces: SettingsNamespaceRow[]; readonly entries?: SectionEntryRow[] }, SettingsReadFailure>
    readonly set: (input: {
      readonly namespace: string
      readonly patch: SettingsPatch
    }) => Effect.Effect<{ readonly namespace: string; readonly applied: string[]; readonly revision: number }, SettingsWriteFailure>
    readonly unset: (input: {
      readonly namespace: string
      readonly path: readonly string[]
    }) => Effect.Effect<{ readonly namespace: string; readonly path: string[] }, SettingsWriteFailure>
    readonly publishSearchEntries: (entries: readonly SectionEntryRow[]) => Effect.Effect<{ readonly count: number }>
  }
>()('@dshfiles/settings-shell/SettingsTools') {
  static readonly layer = Layer.effect(
    SettingsTools,
    Effect.gen(function* () {
      const native = yield* NativeSettings
      const searchEntries = yield* Ref.make<readonly SectionEntryRow[]>([])

      const list = Effect.fn('settings-shell settings list')(function* (input: SettingsListInput) {
        const forms = yield* native.forms
        const query = input.query?.trim().toLowerCase()
        const descriptors = yield* forms.describe
        const namespaces = descriptors
          .filter(descriptor =>
            input.namespace === undefined
              ? query === undefined || query.length === 0 || descriptor.ns.toLowerCase().includes(query)
              : descriptor.ns === input.namespace,
          )
          .map(descriptor => listedRow(descriptor, input.namespace !== undefined))
        if (input.namespace !== undefined && namespaces.length === 0) yield* requireNamespace(forms, input.namespace)
        if (input.namespace !== undefined || query === undefined || query.length === 0) return { writable: forms.writable, namespaces }
        const entries = SettingsSearch.matchEntries({ query, entries: yield* Ref.get(searchEntries) }).slice(0, MAX_LISTED_ENTRIES)
        if (entries.length === 0) return { writable: forms.writable, namespaces }
        return { writable: forms.writable, namespaces, entries }
      })

      const set = Effect.fn('settings-shell settings set')(function* (input: { readonly namespace: string; readonly patch: SettingsPatch }) {
        const forms = yield* Effect.flatMap(native.forms, writableForms)
        const descriptor = yield* requireNamespace(forms, input.namespace)
        yield* forms
          .update({ namespace: input.namespace, patch: input.patch, expectedRevision: descriptor.revision })
          .pipe(Effect.mapError(classifyWriteFailure))
        return { namespace: input.namespace, applied: Object.keys(input.patch).sort(), revision: descriptor.revision }
      })

      const unset = Effect.fn('settings-shell settings unset')(function* (input: { readonly namespace: string; readonly path: readonly string[] }) {
        const forms = yield* Effect.flatMap(native.forms, writableForms)
        const descriptor = yield* requireNamespace(forms, input.namespace)
        yield* forms.unset({ namespace: input.namespace, path: input.path, expectedRevision: descriptor.revision }).pipe(Effect.mapError(classifyWriteFailure))
        return { namespace: input.namespace, path: [...input.path] }
      })

      const publishSearchEntries = (entries: readonly SectionEntryRow[]) => Effect.as(Ref.set(searchEntries, entries), { count: entries.length })

      return SettingsTools.of({ list, set, unset, publishSearchEntries })
    }),
  )
}
