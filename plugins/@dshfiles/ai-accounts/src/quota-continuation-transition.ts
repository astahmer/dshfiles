import type { QuotaContinuationRecord } from './quota-continuation-model.js'

export type QuotaContinuationEvent =
  | { readonly kind: 'queued'; readonly queueSource: 'manual' | 'schedule' | null }
  | { readonly kind: 'ranInHistory' }
  | { readonly kind: 'newerWork' }
  | { readonly kind: 'notReady' }
  | { readonly kind: 'dropped' }

export const isActive = (record: QuotaContinuationRecord): boolean => record.state === 'waiting' || record.state === 'queued'

/** A retired recovery keeps no queue and no Schedule task: its state is its whole outcome. */
const ended = (record: QuotaContinuationRecord, state: 'completed' | 'invalidated'): QuotaContinuationRecord => ({
  ...record,
  state,
  scheduleId: null,
  queueSource: null,
})

/**
 * The only way a recovery changes state. A retired recovery ignores every event, so a stale read cannot revive one.
 */
export const transition = (record: QuotaContinuationRecord, event: QuotaContinuationEvent): QuotaContinuationRecord => {
  if (!isActive(record)) return record
  switch (event.kind) {
    case 'queued':
      return { ...record, state: 'queued', scheduleId: null, queueSource: event.queueSource }
    case 'ranInHistory':
      return ended(record, 'completed')
    case 'newerWork':
    case 'dropped':
      return ended(record, 'invalidated')
    case 'notReady':
      return { ...record, state: 'waiting', scheduleId: null, queueSource: null }
  }
}
