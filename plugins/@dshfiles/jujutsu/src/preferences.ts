import { useSettings } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'
import { useEffect } from 'react'
import { SchemaHelpers } from './schema-helpers.js'
import { jujutsuSettings } from './settings.js'

const LEGACY_PREFERENCES_KEY = 'dshfiles.jujutsu.preferences.v1'

/**
 * Each preference decodes on its own so one stale value never resets the rest;
 * an invalid or missing field falls back to its default.
 */
const preferenceSchemas = {
  defaultView: Schema.Literals(['graph', 'source']),
  ancestorCount: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20)),
  fileView: Schema.Literals(['flat', 'tree']),
  diffExpanded: Schema.Boolean,
  diffLayout: Schema.Literals(['auto', 'unified', 'split']),
  hideImmutable: Schema.Boolean,
  mineOnly: Schema.Boolean,
  dateHeadings: Schema.Boolean,
  revisionDate: Schema.Literals(['edited', 'created', 'both']),
  graphDensity: Schema.Literals(['comfortable', 'compact']),
  refreshMode: Schema.Literals(['interval', 'manual']),
  refreshIntervalSeconds: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(10)),
  refreshOnVisible: Schema.Boolean,
  composerBar: Schema.Boolean,
  composerChips: Schema.Boolean,
  headerToggle: Schema.Boolean,
  chatReferenceLinks: Schema.Boolean,
  chatReferenceClickBehavior: Schema.Literals(['focus', 'path']),
  composerBarBase: Schema.String.check(Schema.isMaxLength(512)),
} satisfies Record<string, Schema.ConstraintDecoder<unknown>>

type PreferenceSchemas = typeof preferenceSchemas

export type JujutsuPreferences = { readonly [Key in keyof PreferenceSchemas]: PreferenceSchemas[Key]['Type'] }
export type GraphDensity = JujutsuPreferences['graphDensity']
export type RevisionDate = JujutsuPreferences['revisionDate']

export const ANCESTOR_COUNT_OPTIONS = [1, 2, 3, 5, 8, 10, 15, 20] as const

const DEFAULT_PREFERENCES: JujutsuPreferences = {
  defaultView: 'graph',
  ancestorCount: 5,
  fileView: 'tree',
  diffExpanded: false,
  diffLayout: 'auto',
  hideImmutable: false,
  mineOnly: false,
  dateHeadings: false,
  revisionDate: 'edited',
  graphDensity: 'comfortable',
  refreshMode: 'interval',
  refreshIntervalSeconds: 60,
  refreshOnVisible: true,
  composerBar: true,
  composerChips: true,
  headerToggle: false,
  chatReferenceLinks: true,
  chatReferenceClickBehavior: 'focus',
  composerBarBase: 'project',
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const decodeField = <Key extends keyof PreferenceSchemas>(key: Key, source: Record<string, unknown>): PreferenceSchemas[Key]['Type'] =>
  SchemaHelpers.decodeOr(preferenceSchemas[key], source[key], DEFAULT_PREFERENCES[key])

/** Decode a settings value field by field so one stale value never resets the rest. */
export const decodePreferences = (value: unknown): JujutsuPreferences => {
  const source = isRecord(value) ? value : {}
  return {
    defaultView: decodeField('defaultView', source),
    ancestorCount: decodeField('ancestorCount', source),
    fileView: decodeField('fileView', source),
    diffExpanded: decodeField('diffExpanded', source),
    diffLayout: decodeField('diffLayout', source),
    hideImmutable: decodeField('hideImmutable', source),
    mineOnly: decodeField('mineOnly', source),
    dateHeadings: decodeField('dateHeadings', source),
    revisionDate: decodeField('revisionDate', source),
    graphDensity: decodeField('graphDensity', source),
    refreshMode: decodeField('refreshMode', source),
    refreshIntervalSeconds: decodeField('refreshIntervalSeconds', source),
    refreshOnVisible: decodeField('refreshOnVisible', source),
    composerBar: decodeField('composerBar', source),
    composerChips: decodeField('composerChips', source),
    headerToggle: decodeField('headerToggle', source),
    chatReferenceLinks: decodeField('chatReferenceLinks', source),
    chatReferenceClickBehavior: decodeField('chatReferenceClickBehavior', source),
    composerBarBase: decodeField('composerBarBase', source),
  }
}

const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES).filter((key): key is keyof JujutsuPreferences => key in DEFAULT_PREFERENCES)

const parseStored = (raw: string | null): JujutsuPreferences => {
  if (raw === null) return decodePreferences({})
  try {
    return decodePreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

/** Read the pre-Settings localStorage record: the decoded values and the fields that differ from defaults. */
export const legacyPreferences = (raw: string | null) => {
  const values = decodePreferences(parseStored(raw))
  return { values, changed: PREFERENCE_KEYS.filter(key => values[key] !== DEFAULT_PREFERENCES[key]) }
}

type PreferenceWriter = <Key extends keyof JujutsuPreferences>(key: Key, value: JujutsuPreferences[Key]) => Promise<void>

let legacyMigrationStarted = false

const migrateLegacyPreferences = async (write: PreferenceWriter): Promise<void> => {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LEGACY_PREFERENCES_KEY)
  } catch {
    return
  }
  if (raw === null) return
  const legacy = legacyPreferences(raw)
  const writeField = <Key extends keyof JujutsuPreferences>(key: Key): Promise<void> => write(key, legacy.values[key])
  for (const key of legacy.changed) await writeField(key)
  try {
    localStorage.removeItem(LEGACY_PREFERENCES_KEY)
  } catch {
    // Values already live in Settings; a leftover local copy is ignored after this page load.
  }
}

/** Jujutsu view preferences stored in DSH Settings, shared live by the main page and the side panel. */
export const usePreferences = (): readonly [JujutsuPreferences, <Key extends keyof JujutsuPreferences>(key: Key, value: JujutsuPreferences[Key]) => void] => {
  const settings = useSettings(jujutsuSettings)
  const preferences = decodePreferences(settings.value ?? {})
  const write = settings.set

  useEffect(() => {
    if (settings.status !== 'ready' || !settings.writable || legacyMigrationStarted) return
    legacyMigrationStarted = true
    void migrateLegacyPreferences(async (key, value) => {
      await write(key, value)
    }).catch(() => {
      legacyMigrationStarted = false
    })
  }, [settings.status, settings.writable, write])

  const update = <Key extends keyof JujutsuPreferences>(key: Key, value: JujutsuPreferences[Key]): void => {
    if (settings.writable) void write(key, value)
  }
  return [preferences, update]
}
