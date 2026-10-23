import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

export const WINDOW_OPTIONS = [15, 60, 1_440, 10_080] as const

export const tracesViewSchema = z
  .object({
    tab: z.enum(['traces', 'logs', 'operations', 'errors']).catch('traces'),
    search: z.string().max(200).catch(''),
    service: z.string().max(256).nullable().catch(null),
    operation: z.string().max(256).nullable().catch(null),
    status: z.enum(['all', 'error', 'ok']).catch('all'),
    minDurationMs: z.number().nonnegative().nullable().catch(null),
    windowMinutes: z.number().int().positive().catch(60),
  })
  .strip()

export type TracesView = z.infer<typeof tracesViewSchema>

export const defaultTracesView: TracesView = {
  tab: 'traces',
  search: '',
  service: null,
  operation: null,
  status: 'all',
  minDurationMs: null,
  windowMinutes: 60,
}

/** The panel's tab, filters and window survive a reload and are shared by every browser tab, like a URL would be. */
export const storedTracesView = createStoredValue({ key: 'dshfiles.traces.view.v1', schema: tracesViewSchema, fallback: defaultTracesView })
