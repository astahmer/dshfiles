import { z } from 'zod'
import {
  DEFAULT_PREFERENCES,
  type SidebarPreferences,
  type SidebarSection,
} from './organization.js'

export const PREFERENCES_STORAGE_KEY = 'dshfiles.thread-sidebar.v1'

const sidebarSectionSchema = z.enum(['pinned', 'active', 'parked', 'inactive', 'archived'])

const preferencesSchema = z.object({
  autoArchiveEnabled: z.boolean(),
  idleMinutes: z.number().int().min(15).max(10080),
  scanIntervalMinutes: z.number().int().min(1).max(120),
  excludedWorkspaceIds: z.array(z.string().min(1).max(256)).max(500),
  excludedSessionIds: z.array(z.string().min(1).max(256)).max(500),
  parkedSessionIds: z.array(z.string().min(1).max(256)).max(5000),
  collapsedSections: z.array(sidebarSectionSchema).max(5),
  workspaceFilter: z.string().max(256).nullable(),
  headerMode: z.enum(['compact', 'expanded']),
  headerOrder: z.array(z.string().min(1).max(256)).max(300),
  hiddenHeaderIds: z.array(z.string().min(1).max(256)).max(300),
  footerOrder: z.array(z.string().min(1).max(256)).max(300),
  hiddenFooterIds: z.array(z.string().min(1).max(256)).max(300),
}).strict()

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

export const toggleCollapsedSection = (
  collapsedSections: readonly SidebarSection[],
  section: SidebarSection,
): SidebarSection[] =>
  collapsedSections.includes(section)
    ? collapsedSections.filter(item => item !== section)
    : [...collapsedSections, section]
