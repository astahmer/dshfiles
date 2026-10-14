import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { masterFeatureIds, privacyFeatures, type PrivacyFeatureId } from './features.js'
import type { PrivacyControlsSnapshot, PrivacyFeatureState } from './api/privacy-controls.js'
import { readManagedOverrides, withFeatureStates, type FeatureUpdate } from './profile-patch.js'

const unavailableReason = 'This profile has no editable Cordis patch or Loader service.'

const readPatch = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8')
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return ''
    throw cause
  }
}

const writePatch = async (path: string, text: string): Promise<void> => {
  const mode = await stat(path).then(
    info => info.mode & 0o777,
    cause => {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return 0o600
      throw cause
    },
  )
  const temporary = `${path}.${randomUUID()}.privacy-controls.tmp`
  await writeFile(temporary, text, { encoding: 'utf8', mode })
  try {
    await rename(temporary, path)
  } catch (cause) {
    await rm(temporary, { force: true })
    throw cause
  }
}

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

export const readPrivacyControls = async (ctx: Context): Promise<PrivacyControlsSnapshot> => {
  const patchPath = ctx.get('profileContext')?.patchPath
  const loader = ctx.get('loader')
  if (patchPath === undefined || loader === undefined) return unavailableSnapshot(unavailableReason)

  const [patchText, entries] = await Promise.all([readPatch(patchPath), Promise.resolve([...loader.entries()])])
  const managedOverrides = readManagedOverrides(patchText)
  const liveReload = ctx.get('hmr') !== undefined
  const features = privacyFeatures.map(feature => {
    const controlledRows = feature.rows.map(row => {
      const matches = entries.filter(entry => entry.options.id === row.patchId)
      const entry = matches.length === 1 ? matches[0] : undefined
      return { row, entry, ambiguous: matches.length > 1 }
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
      const override = managedOverrides.get(`${feature.id}:${row.patchId}`)
      return override === undefined ? !entry.disabled : !override
    })
    const activeEnabled = controlledRows.every(({ entry }) => entry !== undefined && !entry.disabled)
    const enabled = rowEnabled.every(Boolean)
    const mixed = rowEnabled.some(value => value !== rowEnabled[0])
    const notApplied = enabled !== activeEnabled
    return {
      feature: feature.id,
      enabled,
      available: true,
      mixed,
      needsRestart: notApplied && !liveReload,
      overridden: notApplied && liveReload,
      reason: notApplied && liveReload ? 'A later profile layer is still overriding this switch.' : null,
    }
  })

  return { available: true, liveReload, reason: null, features }
}

const stateOf = (snapshot: PrivacyControlsSnapshot, id: PrivacyFeatureId): PrivacyFeatureState => {
  const state = snapshot.features.find(feature => feature.feature === id)
  if (state === undefined) throw new Error(`Unknown privacy feature: ${id}.`)
  return state
}

const validateDependencies = (snapshot: PrivacyControlsSnapshot, updates: readonly FeatureUpdate[]): void => {
  const requested = new Map<PrivacyFeatureId, boolean>()
  for (const update of updates) requested.set(update.feature, update.enabled)
  const answerUiEnabled = requested.get('answer-feedback-ui') ?? stateOf(snapshot, 'answer-feedback-ui').enabled
  const sessionCaptureEnabled = requested.get('session-feedback-capture') ?? stateOf(snapshot, 'session-feedback-capture').enabled
  if (answerUiEnabled && !sessionCaptureEnabled) {
    throw new Error('Enable Session feedback capture before Answer feedback UI; DSH requires the sessionFeedback Remote to load that UI.')
  }
}

const persistFeatureUpdates = async (ctx: Context, updates: readonly FeatureUpdate[]): Promise<PrivacyControlsSnapshot> => {
  const snapshot = await readPrivacyControls(ctx)
  if (!snapshot.available) throw new Error(snapshot.reason ?? unavailableReason)
  for (const update of updates) {
    const state = stateOf(snapshot, update.feature)
    if (!state.available) throw new Error(state.reason ?? `Privacy feature ${update.feature} is unavailable.`)
  }
  validateDependencies(snapshot, updates)

  const changedUpdates = updates.filter(update => {
    const state = stateOf(snapshot, update.feature)
    return state.enabled !== update.enabled || state.mixed
  })
  if (changedUpdates.length === 0) return snapshot

  const patchPath = ctx.get('profileContext')?.patchPath
  if (patchPath === undefined) throw new Error(unavailableReason)
  const apply = async (): Promise<void> => {
    const text = await readPatch(patchPath)
    const next = withFeatureStates(text, changedUpdates)
    if (next !== text) await writePatch(patchPath, next)
  }
  const hmr = ctx.get('hmr')
  await (hmr === undefined ? apply() : hmr.runExclusive(apply))
  return readPrivacyControls(ctx)
}

export const setPrivacyFeatureEnabled = async (
  ctx: Context,
  input: { readonly feature: PrivacyFeatureId; readonly enabled: boolean },
): Promise<PrivacyControlsSnapshot> => persistFeatureUpdates(ctx, [input])

export const setAllPrivacyFeaturesEnabled = async (ctx: Context, enabled: boolean): Promise<PrivacyControlsSnapshot> => {
  const snapshot = await readPrivacyControls(ctx)
  if (!snapshot.available) throw new Error(snapshot.reason ?? unavailableReason)

  const updates = masterFeatureIds.map(feature => ({ feature, enabled }))
  if (enabled) {
    const unavailableFeatureState = updates.map(update => stateOf(snapshot, update.feature)).find(state => !state.available)
    if (unavailableFeatureState !== undefined) {
      throw new Error(unavailableFeatureState.reason ?? 'All feedback and upload features must exist in this profile before enabling them together.')
    }
  }
  return persistFeatureUpdates(ctx, enabled ? updates : updates.filter(update => stateOf(snapshot, update.feature).available))
}
