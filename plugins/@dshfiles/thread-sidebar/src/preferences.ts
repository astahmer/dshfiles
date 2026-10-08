import { z } from 'zod'
import { DEFAULT_PREFERENCES, type SidebarPreferences, type SidebarSection } from './organization.js'

export const PREFERENCES_STORAGE_KEY = 'dshfiles.thread-sidebar.v1'

const sidebarSectionSchema = z.enum(['pinned', 'active', 'parked', 'inactive', 'archived'])

const preferencesSchema = z
  .object({
    autoArchiveEnabled: z.boolean(),
    idleMinutes: z.number().int().min(15).max(10080),
    scanIntervalMinutes: z.number().int().min(1).max(120),
    excludedWorkspaceIds: z.array(z.string().min(1).max(256)).max(500),
    excludedSessionIds: z.array(z.string().min(1).max(256)).max(500),
    parkedSessionIds: z.array(z.string().min(1).max(256)).max(5000),
    collapsedSections: z.array(sidebarSectionSchema).max(5),
    workspaceFilter: z.string().max(256).nullable(),
    headerMode: z.enum(['compact', 'expanded']),
    headerRegionHeight: z.number().int().min(40).max(10000).nullable().default(null),
    headerOrder: z.array(z.string().min(1).max(256)).max(300),
    hiddenHeaderIds: z.array(z.string().min(1).max(256)).max(300),
    footerOrder: z.array(z.string().min(1).max(256)).max(300),
    hiddenFooterIds: z.array(z.string().min(1).max(256)).max(300),
    navigationDensity: z.enum(['compact', 'comfortable']).default(DEFAULT_PREFERENCES.navigationDensity),
    navigationOverflow: z.enum(['scroll', 'menu', 'scroll-menu']).default(DEFAULT_PREFERENCES.navigationOverflow),
    paletteChord: z.string().max(64).nullable().default(DEFAULT_PREFERENCES.paletteChord),
    threadSearchChord: z.string().max(64).nullable().default(DEFAULT_PREFERENCES.threadSearchChord),
    paletteRecentLimit: z.number().int().min(5).max(100).default(DEFAULT_PREFERENCES.paletteRecentLimit),
  })
  .strict()

/** Decode a Host settings value; null when it does not satisfy the sidebar contract. */
export const decodePreferences = (value: unknown): SidebarPreferences | null => {
  const checked = preferencesSchema.safeParse(value)
  return checked.success ? checked.data : null
}

/**
 * Browser values to copy into Host settings once: only keys the Host still holds
 * at their default, so another device's choices are never overwritten.
 */
export const preferencesToMigrate = (local: SidebarPreferences, host: SidebarPreferences): Partial<SidebarPreferences> => {
  const patch: Partial<SidebarPreferences> = {}
  for (const key of Object.keys(DEFAULT_PREFERENCES).filter(isPreferenceKey)) {
    const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
    if (same(host[key], DEFAULT_PREFERENCES[key]) && !same(local[key], host[key])) Object.assign(patch, { [key]: local[key] })
  }
  return patch
}

export const isPreferenceKey = (key: string): key is keyof SidebarPreferences => key in DEFAULT_PREFERENCES

export const readStoredPreferences = (): SidebarPreferences | null => {
  try {
    const stored = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
    return stored === null ? null : parseStoredPreferences(stored)
  } catch {
    return null
  }
}

export const clearStoredPreferences = (): void => {
  try {
    window.localStorage.removeItem(PREFERENCES_STORAGE_KEY)
  } catch {
    return
  }
}

export const parseStoredPreferences = (stored: string | null): SidebarPreferences => {
  if (stored === null) return DEFAULT_PREFERENCES

  try {
    const parsed: unknown = JSON.parse(stored)
    const checked = preferencesSchema.safeParse(parsed)
    if (!checked.success) return DEFAULT_PREFERENCES
    return checked.data
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export const loadPreferences = (): SidebarPreferences => {
  try {
    return parseStoredPreferences(window.localStorage.getItem(PREFERENCES_STORAGE_KEY))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export const savePreferences = (preferences: SidebarPreferences): boolean => {
  const checked = preferencesSchema.safeParse(preferences)
  if (!checked.success) return false

  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(checked.data))
    return true
  } catch {
    return false
  }
}

export const toggleCollapsedSection = (collapsedSections: readonly SidebarSection[], section: SidebarSection): SidebarSection[] =>
  collapsedSections.includes(section) ? collapsedSections.filter(item => item !== section) : [...collapsedSections, section]
