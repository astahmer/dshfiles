import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { panelOccurrenceStorageKey } from '@dshfiles/workbench/panel-occurrence'
import { Schema } from 'effect'

const PANEL_ID = 'dshfiles-whiteboard'
/** Presentations of the one panel that existed before occurrences had their own keys. */
const ORIGINAL_IDS = new Set([PANEL_ID, `main/${PANEL_ID}`])
const LEGACY_KEY = 'dshfiles-whiteboard:project'

/** A selection saved before occurrences (then scopes) had their own keys seeds the first occurrence that asks for it. */
export const projectPreferences = (panelId: string | undefined, scopeKey?: string) => {
  const key =
    panelId === undefined || ORIGINAL_IDS.has(panelId)
      ? LEGACY_KEY
      : panelOccurrenceStorageKey({ base: LEGACY_KEY, panelId, scopeKey, legacyKeys: [`${LEGACY_KEY}/panel/${encodeURIComponent(panelId)}`, LEGACY_KEY] })
  return createStoredValue({ key, schema: Schema.NullOr(Schema.String), fallback: null })
}
