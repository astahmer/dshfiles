import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { panelOccurrence } from '@dshfiles/workbench/panel-occurrence'
import * as Schema from 'effect/Schema'
import { storedTracesView, tracesViewFor } from './view-state.js'

export const logsViewSchema = Schema.Struct({
  search: Schema.String.check(Schema.isMaxLength(200)),
  service: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  minSeverity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(24)),
  attribute: Schema.String.check(Schema.isMaxLength(640)),
})
export type LogsView = Schema.Schema.Type<typeof logsViewSchema>
const logsViewFor = (panelId?: string) =>
  createStoredValue({
    key: panelId === undefined ? 'dshfiles.traces.logs-view.v1' : `dshfiles.traces.logs-view.v1/panel/${encodeURIComponent(panelId)}`,
    schema: logsViewSchema,
    fallback: { search: '', service: null, minSeverity: 0, attribute: '' },
  })
export const storedLogsView = logsViewFor()
const boardIdFor = (panelId?: string) =>
  createStoredValue({
    key: panelId === undefined ? 'dshfiles.traces.board.v1' : `dshfiles.traces.board.v1/panel/${encodeURIComponent(panelId)}`,
    schema: Schema.String.check(Schema.isMaxLength(64)),
    fallback: 'slow-tools',
  })
export const storedBoardId = boardIdFor()

const nativeStores = { traces: storedTracesView, logs: storedLogsView, board: storedBoardId }
export type PanelStores = typeof nativeStores
const occurrences = new Map<string, PanelStores>()
export const panelStores = (panelId?: string, scopeKey?: string): PanelStores => {
  if (panelId === undefined) return nativeStores
  const key = panelOccurrence({ panelId, scopeKey })
  const existing = occurrences.get(key)
  if (existing !== undefined) return existing
  const stores = { traces: tracesViewFor(key), logs: logsViewFor(key), board: boardIdFor(key) }
  occurrences.set(key, stores)
  return stores
}
