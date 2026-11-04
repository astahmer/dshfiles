import { Context, Effect, FileSystem, Layer, Random, Schema } from 'effect'
import type { PrivacyControlsSnapshot, PrivacyFeatureState } from './api/privacy-controls.js'
import { masterFeatureIds, privacyFeatures, type PrivacyFeatureId } from './features.js'
import { readManagedOverrides, withFeatureStates, type FeatureUpdate } from './profile-patch.js'

const unavailableReason = 'This profile has no editable Cordis patch or Loader service.'

/** This profile has no editable Cordis patch or no Loader service, so no switch can be read or written. */
export class PrivacyControlsUnavailable extends Schema.TaggedError<PrivacyControlsUnavailable>()(
  'PrivacyControlsUnavailable',
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'privacy-controls-unavailable' },
) {
  override get message(): string {
    return this.reason
  }
}

/** The Loader rows a feature switches are missing or ambiguous in this profile. */
export class PrivacyFeatureUnavailable extends Schema.TaggedError<PrivacyFeatureUnavailable>()(
  'PrivacyFeatureUnavailable',
  { feature: Schema.String, reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'privacy-feature-unavailable' },
) {
  override get message(): string {
    return this.reason
  }
}

/** Answer feedback UI would stay enabled while Session feedback capture, the Remote it loads from, is disabled. */
export class PrivacyFeatureDependency extends Schema.TaggedError<PrivacyFeatureDependency>()(
  'PrivacyFeatureDependency',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'privacy-feature-dependency' },
) {
  override get message(): string {
    return 'Enable Session feedback capture before Answer feedback UI; DSH requires the sessionFeedback Remote to load that UI.'
  }
}

export class ProfilePatchReadFailed extends Schema.TaggedError<ProfilePatchReadFailed>()(
  'ProfilePatchReadFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'profile-patch-read-failed' },
) {
  override get message(): string {
    return 'The profile Cordis patch could not be read. Check its file permissions, then retry.'
  }
}

export class ProfilePatchWriteFailed extends Schema.TaggedError<ProfilePatchWriteFailed>()(
  'ProfilePatchWriteFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'profile-patch-write-failed' },
) {
  override get message(): string {
    return 'The profile Cordis patch could not be written. Check its folder permissions and free disk space, then retry.'
  }
}

/** Live reload refused or failed the exclusive section the patch write runs in. */
export class LiveReloadLockFailed extends Schema.TaggedError<LiveReloadLockFailed>()(
  'LiveReloadLockFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'live-reload-lock-failed' },
) {
  override get message(): string {
    return 'Live reload could not apply the profile change. Retry once the current reload finishes, or restart the DSH Host.'
  }
}

export interface LoaderRow {
  readonly options: { readonly id: string }
  readonly disabled: boolean
}

/** The running profile as the Host sees it: where its Cordis patch lives, its Loader rows, and live reload. */
export class PrivacyProfile extends Context.Service<
  PrivacyProfile,
  {
    readonly patchPath: string | undefined
    readonly entries: Effect.Effect<ReadonlyArray<LoaderRow> | undefined>
    readonly liveReload: boolean
    /** Run a profile write while live reload holds every other reload back; runs it directly without live reload. */
    readonly exclusive: <A, E>(write: Effect.Effect<A, E>) => Effect.Effect<A, E | LiveReloadLockFailed>
  }
>()('@dshfiles/privacy-controls/PrivacyProfile') {}

export type PrivacyControlsFailure =
  | PrivacyControlsUnavailable
  | PrivacyFeatureUnavailable
  | PrivacyFeatureDependency
  | ProfilePatchReadFailed
  | ProfilePatchWriteFailed
  | LiveReloadLockFailed

const unavailableFeature = (feature: (typeof privacyFeatures)[number], reason: string): PrivacyFeatureState => ({
  feature: feature.id,
  enabled: feature.defaultEnabled,
  available: false,
  mixed: false,
  needsRestart: false,
  overridden: false,
  reason,
})

const unavailableSnapshot = (reason: string): PrivacyControlsSnapshot => ({
  available: false,
  liveReload: false,
  reason,
  features: privacyFeatures.map(feature => unavailableFeature(feature, reason)),
})

const featureStates = (input: {
  readonly entries: ReadonlyArray<LoaderRow>
  readonly managedOverrides: ReadonlyMap<string, boolean>
  readonly liveReload: boolean
}): PrivacyFeatureState[] =>
  privacyFeatures.map(feature => {
    const controlledRows = feature.rows.map(row => {
      const matches = input.entries.filter(entry => entry.options.id === row.patchId)
      return { row, entry: matches.length === 1 ? matches[0] : undefined, ambiguous: matches.length > 1 }
    })
    const unavailableRow = controlledRows.find(row => row.entry === undefined)
    if (unavailableRow !== undefined) {
      const reason = unavailableRow.ambiguous
        ? `Loader row ${unavailableRow.row.patchId} appears more than once in this profile.`
        : `Loader row ${unavailableRow.row.patchId} is not present in this profile.`
      return unavailableFeature(feature, reason)
    }

    const rowEnabled = controlledRows.map(({ row, entry }) => {
      if (entry === undefined) return false
      const override = input.managedOverrides.get(`${feature.id}:${row.patchId}`)
      return override === undefined ? !entry.disabled : !override
    })
    const activeEnabled = controlledRows.every(({ entry }) => entry !== undefined && !entry.disabled)
    const enabled = rowEnabled.every(Boolean)
    const notApplied = enabled !== activeEnabled
    return {
      feature: feature.id,
      enabled,
      available: true,
      mixed: rowEnabled.some(value => value !== rowEnabled[0]),
      needsRestart: notApplied && !input.liveReload,
      overridden: notApplied && input.liveReload,
      reason: notApplied && input.liveReload ? 'A later profile layer is still overriding this switch.' : null,
    }
  })

const stateOf = (snapshot: PrivacyControlsSnapshot, id: PrivacyFeatureId): PrivacyFeatureState =>
  snapshot.features.find(feature => feature.feature === id) ?? {
    feature: id,
    enabled: false,
    available: false,
    mixed: false,
    needsRestart: false,
    overridden: false,
    reason: `Unknown privacy feature: ${id}.`,
  }

const requireAvailable = (snapshot: PrivacyControlsSnapshot) =>
  snapshot.available ? Effect.void : Effect.fail(new PrivacyControlsUnavailable({ reason: snapshot.reason ?? unavailableReason }))

const requireFeatureAvailable = (state: PrivacyFeatureState, fallbackReason: string) =>
  state.available ? Effect.void : Effect.fail(new PrivacyFeatureUnavailable({ feature: state.feature, reason: state.reason ?? fallbackReason }))

const keepsFeedbackRemote = (snapshot: PrivacyControlsSnapshot, updates: readonly FeatureUpdate[]): boolean => {
  const requested = new Map<PrivacyFeatureId, boolean>(updates.map(update => [update.feature, update.enabled]))
  const answerUiEnabled = requested.get('answer-feedback-ui') ?? stateOf(snapshot, 'answer-feedback-ui').enabled
  const sessionCaptureEnabled = requested.get('session-feedback-capture') ?? stateOf(snapshot, 'session-feedback-capture').enabled
  return !answerUiEnabled || sessionCaptureEnabled
}

/** Reads and writes the feedback, upload and session-log download switches of the running profile's Cordis patch. */
export class PrivacyControls extends Context.Service<
  PrivacyControls,
  {
    readonly read: Effect.Effect<PrivacyControlsSnapshot, ProfilePatchReadFailed>
    readonly setFeature: (input: {
      readonly feature: PrivacyFeatureId
      readonly enabled: boolean
    }) => Effect.Effect<PrivacyControlsSnapshot, PrivacyControlsFailure>
    readonly setAll: (enabled: boolean) => Effect.Effect<PrivacyControlsSnapshot, PrivacyControlsFailure>
  }
>()('@dshfiles/privacy-controls/PrivacyControls') {
  static readonly layer = Layer.effect(
    PrivacyControls,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const profile = yield* PrivacyProfile

      const readPatch = (path: string) =>
        fs
          .readFileString(path)
          .pipe(
            Effect.catchTag('PlatformError', error =>
              error.reason._tag === 'NotFound' ? Effect.succeed('') : Effect.fail(new ProfilePatchReadFailed({ cause: error })),
            ),
          )

      const writePatch = Effect.fn('privacy patch write')(
        function* (path: string, text: string) {
          const mode = yield* fs.stat(path).pipe(
            Effect.map(info => info.mode & 0o777),
            Effect.catchTag('PlatformError', error => (error.reason._tag === 'NotFound' ? Effect.succeed(0o600) : Effect.fail(error))),
          )
          const suffix = (yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)).toString(36)
          const temporary = `${path}.${suffix}.privacy-controls.tmp`
          yield* fs.writeFileString(temporary, text, { mode })
          yield* fs.rename(temporary, path).pipe(Effect.onError(() => fs.remove(temporary, { force: true }).pipe(Effect.ignore)))
        },
        Effect.mapError(cause => new ProfilePatchWriteFailed({ cause })),
      )

      const read = Effect.gen(function* () {
        const entries = yield* profile.entries
        if (profile.patchPath === undefined || entries === undefined) return unavailableSnapshot(unavailableReason)
        const managedOverrides = readManagedOverrides(yield* readPatch(profile.patchPath))
        const snapshot: PrivacyControlsSnapshot = {
          available: true,
          liveReload: profile.liveReload,
          reason: null,
          features: featureStates({ entries, managedOverrides, liveReload: profile.liveReload }),
        }
        return snapshot
      }).pipe(Effect.withSpan('privacy controls read'))

      const persist = Effect.fn('privacy features persist')(function* (updates: readonly FeatureUpdate[]) {
        const snapshot = yield* read
        yield* requireAvailable(snapshot)
        for (const update of updates) yield* requireFeatureAvailable(stateOf(snapshot, update.feature), `Privacy feature ${update.feature} is unavailable.`)
        if (!keepsFeedbackRemote(snapshot, updates)) return yield* new PrivacyFeatureDependency({})

        const changed = updates.filter(update => {
          const state = stateOf(snapshot, update.feature)
          return state.enabled !== update.enabled || state.mixed
        })
        if (changed.length === 0) return snapshot
        const patchPath = profile.patchPath
        if (patchPath === undefined) return yield* new PrivacyControlsUnavailable({ reason: unavailableReason })

        const apply = Effect.gen(function* () {
          const text = yield* readPatch(patchPath)
          const next = withFeatureStates(text, changed)
          if (next !== text) yield* writePatch(patchPath, next)
        })
        yield* profile.exclusive(apply)
        return yield* read
      })

      const setFeature = Effect.fn('privacy feature set')(function* (input: { readonly feature: PrivacyFeatureId; readonly enabled: boolean }) {
        return yield* persist([input])
      })

      const setAll = Effect.fn('privacy features set all')(function* (enabled: boolean) {
        const snapshot = yield* read
        yield* requireAvailable(snapshot)
        const updates = masterFeatureIds.map(feature => ({ feature, enabled }))
        if (!enabled) return yield* persist(updates.filter(update => stateOf(snapshot, update.feature).available))
        for (const update of updates) {
          yield* requireFeatureAvailable(
            stateOf(snapshot, update.feature),
            'All feedback and upload features must exist in this profile before enabling them together.',
          )
        }
        return yield* persist(updates)
      })

      return PrivacyControls.of({ read, setFeature, setAll })
    }),
  )
}
