import * as Schema from 'effect/Schema'
import { createStoredValue } from './stored-value.js'

export const WINDOW_OPTIONS = [15, 60, 1_440, 10_080] as const

const FINITE_NON_NEGATIVE = Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThanOrEqualTo(0))

export const tracesTabSchema = Schema.Literals(['traces', 'logs', 'map', 'metrics', 'operations', 'errors', 'alerts', 'boards'])

export const tracesViewSchema = Schema.Struct({
  tab: tracesTabSchema,
  search: Schema.String.check(Schema.isMaxLength(200)),
  service: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  operation: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  status: Schema.Literals(['all', 'error', 'ok']),
  minDurationMs: Schema.NullOr(FINITE_NON_NEGATIVE),
  windowMinutes: Schema.Int.check(Schema.isGreaterThan(0)),
})

export type TracesView = Schema.Schema.Type<typeof tracesViewSchema>

const defaultTracesView: TracesView = {
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
