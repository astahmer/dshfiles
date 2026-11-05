import { BacklogReference } from './backlog-reference.js'
import { DueDates } from './due-date.js'
import { BacklogGates } from './gates.js'
import { BacklogItems, type BacklogItem } from './item.js'

/** A claim on an item: who holds it, and until when it holds without another write from them. */
export interface BacklogLease {
  readonly holder: string
  readonly acquiredAt: number
  readonly expiresAt: number
  readonly heartbeat: number
}

type RelatedItem = Pick<BacklogItem, 'id' | 'ref' | 'status' | 'links' | 'snoozedUntil' | 'parent' | 'priority' | 'createdAt' | 'gates'>

const isOpen = (item: Pick<BacklogItem, 'status'>): boolean => item.status !== 'done' && item.status !== 'dropped'

const pushTo = <Value>(map: Map<string, Value[]>, key: string, value: Value): void => {
  const existing = map.get(key)
  if (existing === undefined) map.set(key, [value])
  else existing.push(value)
}

/**
 * How items relate, derived on read: sub-issues by `parent`, blockers by item links (A `depends-on` B and B `blocks` A
 * both keep A waiting while B is open), and live claims. Built once per read, so a list of hundreds stays one pass.
 */
const build = <Item extends RelatedItem>(input: {
  readonly items: Iterable<Item>
  readonly leases: ReadonlyMap<number, BacklogLease>
  readonly now: number
}) => {
  const byRef = new Map<string, Item>()
  const children = new Map<string, Item[]>()
  const blockerRefs = new Map<string, Set<string>>()
  const addBlocker = (blocked: string, blocker: string): void => {
    if (blocked === blocker) return
    const existing = blockerRefs.get(blocked)
    if (existing === undefined) blockerRefs.set(blocked, new Set([blocker]))
    else existing.add(blocker)
  }
  for (const item of input.items) {
    const ref = BacklogReference.refOf(item)
    byRef.set(ref, item)
    if (item.parent !== undefined) pushTo(children, item.parent, item)
    for (const link of item.links) {
      if (link.type !== 'item') continue
      if (link.relation === 'depends-on') addBlocker(ref, link.target)
      if (link.relation === 'blocks') addBlocker(link.target, ref)
    }
  }
  const childrenOf = (item: Item): Item[] => children.get(BacklogReference.refOf(item)) ?? []
  const openBlockersOf = (item: Item): Item[] =>
    [...(blockerRefs.get(BacklogReference.refOf(item)) ?? [])].flatMap(ref => {
      const blocker = byRef.get(ref)
      return blocker !== undefined && isOpen(blocker) ? [blocker] : []
    })
  const leaseOf = (item: Pick<BacklogItem, 'id'>): BacklogLease | null => {
    const lease = input.leases.get(item.id)
    return lease !== undefined && lease.expiresAt > input.now ? lease : null
  }
  /** Direct sub-issues done out of those still counted: dropped ones leave the total, as in Linear. */
  const rollup = (item: Item) => {
    const counted = childrenOf(item).filter(child => child.status !== 'dropped')
    return { total: counted.length, done: counted.filter(child => child.status === 'done').length }
  }
  const today = DueDates.dateOf(input.now)
  const isGated = (item: Item): boolean => BacklogGates.open(item.gates, today).length > 0
  /** Open and unsnoozed, nothing open in its way, no open gate or sub-issue left, and nobody holding it. */
  const isReady = (item: Item): boolean =>
    (item.status === 'inbox' || item.status === 'todo') &&
    (item.snoozedUntil ?? 0) <= input.now &&
    !isGated(item) &&
    openBlockersOf(item).length === 0 &&
    !childrenOf(item).some(isOpen) &&
    leaseOf(item) === null
  return {
    byRef: (ref: string): Item | undefined => byRef.get(ref),
    childrenOf,
    openBlockersOf,
    leaseOf,
    rollup,
    isReady,
    isGated,
    isBlockedByDeps: (item: Item): boolean => isOpen(item) && openBlockersOf(item).length > 0,
  }
}

export type ItemRelationIndex<Item extends RelatedItem> = ReturnType<typeof build<Item>>

/** Priority first (urgent to low, none last), then the oldest: the order a ready queue serves. */
const byReadiness = (left: RelatedItem, right: RelatedItem): number =>
  BacklogItems.priorityRank(left.priority) - BacklogItems.priorityRank(right.priority) || left.createdAt - right.createdAt || left.id - right.id

/** Why `parent` cannot be `item`'s parent, or null when it can: no self, no cycle, and at most three levels deep. */
const parentProblem = (input: {
  readonly item: Pick<BacklogItem, 'id' | 'ref'>
  readonly parentRef: string
  readonly byRef: (ref: string) => Pick<BacklogItem, 'id' | 'ref' | 'parent'> | undefined
  readonly childrenOf: (ref: string) => readonly Pick<BacklogItem, 'id' | 'ref'>[]
}): string | null => {
  const ownRef = BacklogReference.refOf(input.item)
  const label = BacklogReference.label(ownRef)
  if (input.parentRef === ownRef) return `${label} cannot be its own parent.`
  const parent = input.byRef(input.parentRef)
  if (parent === undefined) return `No item ${BacklogReference.label(input.parentRef)} to nest ${label} under. Check the reference with backlog_get.`
  let depth = 1
  let cursor: Pick<BacklogItem, 'id' | 'ref' | 'parent'> | undefined = parent
  const seen = new Set<string>()
  while (cursor?.parent !== undefined) {
    if (cursor.parent === ownRef) return `${BacklogReference.label(input.parentRef)} is already under ${label}; nesting them both ways would make a loop.`
    if (seen.has(cursor.parent)) break
    seen.add(cursor.parent)
    depth += 1
    cursor = input.byRef(cursor.parent)
  }
  const heightOf = (ref: string, visited: ReadonlySet<string>): number => {
    if (visited.has(ref)) return 0
    const next = new Set(visited).add(ref)
    return 1 + Math.max(0, ...input.childrenOf(ref).map(child => heightOf(BacklogReference.refOf(child), next)))
  }
  const levels = depth + heightOf(ownRef, new Set())
  if (levels > BacklogItems.maxParentDepth)
    return `Nesting ${label} under ${BacklogReference.label(input.parentRef)} would make ${String(levels)} levels; sub-issues go ${String(BacklogItems.maxParentDepth)} deep at most. Pick a parent higher up.`
  return null
}

export class ItemRelations {
  static readonly build = build
  static readonly byReadiness = byReadiness
  static readonly parentProblem = parentProblem
  static readonly isOpen = isOpen
}
