import { useSettings } from '@dshfiles/dshx/client'
import { useMemo } from 'react'
import { frameLayoutSettings } from './settings.ts'
import { DEFAULT_STATUS_STRIP_PREFERENCES, type StatusStripPreferences } from './status-strip-preferences.ts'

export interface StatusStripSettings {
  readonly preferences: StatusStripPreferences
  /** Absent while the Host cannot store the choice (loading, or a Host that predates the namespace). */
  readonly save?: (next: StatusStripPreferences) => void
  readonly error: string | null
}

const sameIds = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((id, index) => id === right[index])

/** Reads the frame's settings namespace; callers must render inside a decorated component. */
export const useStatusStripSettings = (): StatusStripSettings => {
  const settings = useSettings(frameLayoutSettings)
  const value = settings.value
  const preferences = useMemo<StatusStripPreferences>(
    () => (value === undefined ? DEFAULT_STATUS_STRIP_PREFERENCES : { hidden: value.hiddenStatusItems, order: value.statusItemOrder }),
    [value],
  )
  const error = settings.error?.message ?? null
  if (settings.status !== 'ready' || !settings.writable) return { preferences, error }
  const warn = (cause: unknown): void => console.warn('[frame-layout] the status bar choice could not be saved', cause)
  const save = (next: StatusStripPreferences): void => {
    if (!sameIds(next.hidden, preferences.hidden)) settings.set('hiddenStatusItems', [...next.hidden]).catch(warn)
    if (!sameIds(next.order, preferences.order)) settings.set('statusItemOrder', [...next.order]).catch(warn)
  }
  return { preferences, save, error }
}
