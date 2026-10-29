import { useSettings } from '@dshfiles/dshx/client'
import { decodeJson } from '@dshfiles/dshx/json'
import { useEffect } from 'react'
import { z } from 'zod'
import { jujutsuSettings } from './settings.js'

const LEGACY_PREFERENCES_KEY = 'dshfiles.jujutsu.preferences.v1'

const preferencesSchema = z.object({
  defaultView: z.enum(['graph', 'source']).catch('graph'),
  ancestorCount: z.number().int().min(1).max(20).catch(5),
  fileView: z.enum(['flat', 'tree']).catch('tree'),
  diffExpanded: z.boolean().catch(false),
  diffLayout: z.enum(['auto', 'unified', 'split']).catch('auto'),
  hideImmutable: z.boolean().catch(false),
  mineOnly: z.boolean().catch(false),
  dateHeadings: z.boolean().catch(false),
  revisionDate: z.enum(['edited', 'created', 'both']).catch('edited'),
  graphDensity: z.enum(['comfortable', 'compact']).catch('comfortable'),
  refreshMode: z.enum(['interval', 'manual']).catch('interval'),
  refreshIntervalSeconds: z.number().int().min(10).catch(60),
  refreshOnVisible: z.boolean().catch(true),
  composerBar: z.boolean().catch(true),
  composerChips: z.boolean().catch(true),
  headerToggle: z.boolean().catch(false),
  chatReferenceLinks: z.boolean().catch(true),
  chatReferenceClickBehavior: z.enum(['focus', 'path']).catch('focus'),
  composerBarBase: z.string().max(512).catch('main'),
})

export type JujutsuPreferences = z.infer<typeof preferencesSchema>
export type GraphDensity = JujutsuPreferences['graphDensity']
export type RevisionDate = JujutsuPreferences['revisionDate']

export const ANCESTOR_COUNT_OPTIONS = [1, 2, 3, 5, 8, 10, 15, 20] as const

const DEFAULT_PREFERENCES = preferencesSchema.parse({})

/** Decode a settings value field by field so one stale value never resets the rest. */
export const decodePreferences = (value: unknown): JujutsuPreferences => {
  const decoded = preferencesSchema.safeParse(value)
  return decoded.success ? decoded.data : DEFAULT_PREFERENCES
}

const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES).filter((key): key is keyof JujutsuPreferences => key in DEFAULT_PREFERENCES)

const parseStored = (raw: string | null): JujutsuPreferences => {
  if (raw === null) return decodePreferences({})
  try {
    return decodeJson(preferencesSchema, raw)
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
