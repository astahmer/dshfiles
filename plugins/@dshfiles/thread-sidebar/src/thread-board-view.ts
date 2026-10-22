import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import { SIDEBAR_SECTIONS, type SidebarSection } from './organization.js'
import {
  THREAD_GROUP_BY_OPTIONS,
  THREAD_SOURCE_FILTER_OPTIONS,
  THREAD_STATUS_FILTER_OPTIONS,
  type ThreadStatusFilter,
  type ThreadViewPreferences,
} from './thread-view.js'

export interface ThreadBoardViewSettings extends ThreadViewPreferences {
  readonly projectFilter: string | null
  readonly collapsedGroups: readonly string[]
  readonly collapsedSections: readonly SidebarSection[]
}

export const DEFAULT_THREAD_BOARD_VIEW: ThreadBoardViewSettings = {
  groupBy: 'status',
  statusFilters: [],
  sourceFilter: 'all',
  projectFilter: null,
  collapsedGroups: [],
  collapsedSections: [],
}

const groupBySchema = z.enum(THREAD_GROUP_BY_OPTIONS)
const sourceFilterSchema = z.enum(THREAD_SOURCE_FILTER_OPTIONS)
const statusFilterSchema = z.enum(THREAD_STATUS_FILTER_OPTIONS.filter((filter): filter is ThreadStatusFilter => filter !== 'all'))

export const threadBoardViewSchema = z
  .object({
    groupBy: groupBySchema,
    statusFilters: z
      .array(statusFilterSchema)
      .max(THREAD_STATUS_FILTER_OPTIONS.length - 1)
      .readonly(),
    sourceFilter: sourceFilterSchema,
    projectFilter: z.string().max(200).nullable(),
    collapsedGroups: z.array(z.string().max(160)).max(64).readonly(),
    collapsedSections: z.array(z.enum(SIDEBAR_SECTIONS)).max(SIDEBAR_SECTIONS.length).readonly(),
  })
  .strict()
  .superRefine((settings, context) => {
    if (new Set(settings.statusFilters).size !== settings.statusFilters.length) {
      context.addIssue({ code: 'custom', path: ['statusFilters'], message: 'Status filters must be unique.' })
    }
  })

export const storedThreadBoardView = createStoredValue({
  key: 'dshfiles.thread-sidebar.board-view.v1',
  schema: threadBoardViewSchema,
  fallback: DEFAULT_THREAD_BOARD_VIEW,
})

export class ThreadBoardViewModel {
  static readonly update = (
    current: ThreadBoardViewSettings,
    patch: Partial<Pick<ThreadBoardViewSettings, 'groupBy' | 'statusFilters' | 'sourceFilter' | 'projectFilter' | 'collapsedGroups' | 'collapsedSections'>>,
  ): ThreadBoardViewSettings => {
    const result = threadBoardViewSchema.safeParse({ ...current, ...patch })
    return result.success ? result.data : current
  }
}
