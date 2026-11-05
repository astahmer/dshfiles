import type { BacklogHumanField, BacklogItem } from './item.js'
import { BacklogOps, type BacklogOpRecord } from './op-log.js'

/** The typed value a field held: what a revert writes back with a `set`, never the display string the event shows. */
export type FieldValue = BacklogItem[BacklogHumanField]

export type RevertPlan =
  | { readonly kind: 'revert'; readonly before: FieldValue; readonly after: FieldValue }
  /** The change named no longer exists in the log: a wrong time or field. */
  | { readonly kind: 'missing' }
  /** The field changed again after the change named, so writing its earlier value would undo that later change too. */
  | { readonly kind: 'stale'; readonly changedAt: number; readonly by: string }

const valueOf = (item: BacklogItem | null, field: BacklogHumanField): FieldValue | undefined => (item === null ? undefined : item[field])

const recordsInOrder = (records: readonly BacklogOpRecord[]): BacklogOpRecord[] => [...records].sort(BacklogOps.compareRecords)

const namesChange = (item: BacklogItem | null, at: number, field: BacklogHumanField): boolean =>
  item?.events.some(event => event.at === at && event.fieldChanges?.some(change => change.field === field) === true) === true

/**
 * What reverting one recorded field change means, read from the op log: the value the field held just before the write
 * that recorded the change (`at` is that event's time), provided nothing changed the field after it. Each store write
 * appends its field ops and then its event, so the write's ops are the ones after the previous event-changing op.
 */
const plan = (input: {
  readonly records: readonly BacklogOpRecord[]
  readonly id: number
  readonly at: number
  readonly field: BacklogHumanField
}): RevertPlan => {
  const ordered = recordsInOrder(input.records)
  const states: (BacklogItem | null)[] = []
  let item: BacklogItem | null = null
  for (const record of ordered) {
    item = BacklogOps.apply({ id: input.id, item, ops: [record.op] })
    states.push(item)
  }
  const stateBefore = (index: number): BacklogItem | null => (index === 0 ? null : (states[index - 1] ?? null))
  const eventIndex = states.findIndex((state, index) => namesChange(state, input.at, input.field) && !namesChange(stateBefore(index), input.at, input.field))
  if (eventIndex < 0) return { kind: 'missing' }
  let writeStart = eventIndex
  while (writeStart > 0 && stateBefore(writeStart)?.events === stateBefore(writeStart - 1)?.events) writeStart -= 1
  const changeIndex = states.findIndex(
    (state, index) =>
      index >= writeStart && index <= eventIndex && !BacklogOps.sameValue(valueOf(stateBefore(index), input.field), valueOf(state, input.field)),
  )
  if (changeIndex < 0) return { kind: 'missing' }
  const before = valueOf(stateBefore(changeIndex), input.field)
  const after = valueOf(states[eventIndex] ?? null, input.field)
  const later = states.findIndex(
    (state, index) => index > eventIndex && !BacklogOps.sameValue(valueOf(stateBefore(index), input.field), valueOf(state, input.field)),
  )
  const laterRecord = later < 0 ? undefined : ordered[later]
  if (laterRecord !== undefined) return { kind: 'stale', changedAt: laterRecord.hlc.wall, by: laterRecord.origin }
  return { kind: 'revert', before, after }
}

export class FieldRevert {
  static readonly plan = plan
}
