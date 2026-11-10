import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { Schema } from 'effect'

const PANEL_ID = 'dshfiles-whiteboard'
/** Presentations of the one panel that existed before occurrences had their own keys. */
const ORIGINAL_IDS = new Set([PANEL_ID, `main/${PANEL_ID}`])
const LEGACY_KEY = 'dshfiles-whiteboard:project'

const scopedKey = (panelId: string): string => `${LEGACY_KEY}/panel/${encodeURIComponent(panelId)}`

/** A preference saved before Whiteboard isolated occurrences belongs to the first occurrence that asks for it. */
const inheritLegacy = (key: string): void => {
  try {
    if (window.localStorage.getItem(key) !== null) return
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy !== null) window.localStorage.setItem(key, legacy)
  } catch {
    // Storage refused (private mode or quota): the store itself falls back to no selection.
  }
}

export const projectPreferences = (panelId: string | undefined) => {
  const key = panelId === undefined || ORIGINAL_IDS.has(panelId) ? LEGACY_KEY : scopedKey(panelId)
  if (key !== LEGACY_KEY) inheritLegacy(key)
  return createStoredValue({ key, schema: Schema.NullOr(Schema.String), fallback: null })
}
