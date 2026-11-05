import { Struct } from 'effect'
import { BacklogItems, type BacklogAttachment, type BacklogItem } from './item.js'
import type { LegacySnapshot } from './legacy-tables.js'
import { BacklogOps, type BacklogOp, type BacklogOpRecord, type Hlc } from './op-log.js'
import type { SyncMapping } from './sync-legacy-mapping.js'
import { ulid } from './ulid.js'

/** The store reads every item under its project, so the importer files it there too. */
const normalized = (item: BacklogItem): BacklogItem => {
  const project = BacklogItems.projectOf(item.project)
  return project === item.project ? item : { ...item, project }
}

/** When each op happened, so the log keeps the original order and times: the event time, or the item's capture. */
const opTime = (item: BacklogItem, op: BacklogOp): number => {
  if (op.kind === 'event' || op.kind === 'comment') return op.event.at
  if (op.kind === 'attach') return op.attachment.createdAt
  return item.createdAt
}

/**
 * One legacy item as ops: `create` with its scalar fields and capture event, then `add`/`attach` for its tags, links,
 * actors and files, then one op per stored event in order. A final `set` covers whatever the replay does not
 * reproduce, so the fold always equals the item the JSON store served.
 */
const itemOps = (item: BacklogItem): BacklogOp[] => {
  const [first, ...rest] = item.events
  const capture = first?.kind === 'created' ? first : undefined
  const replayed = capture === undefined ? item.events : rest
  const fields = Struct.omit(item, ['id', 'events'])
  const create: BacklogOp = {
    kind: 'create',
    item: { ...fields, tags: [], links: [], actors: [], attachments: [] },
    ...(capture !== undefined && { event: capture }),
  }
  const ops: BacklogOp[] = [
    create,
    ...item.tags.map(value => ({ kind: 'add' as const, field: 'tags' as const, value })),
    ...item.links.map(value => ({ kind: 'add' as const, field: 'links' as const, value })),
    ...item.actors.map(value => ({ kind: 'add' as const, field: 'actors' as const, value })),
    ...item.attachments.map((attachment: BacklogAttachment) => ({ kind: 'attach' as const, attachment })),
    ...replayed.map(event => (event.kind === 'commented' ? { kind: 'comment' as const, event } : { kind: 'event' as const, event })),
  ]
  const folded = BacklogOps.apply({ id: item.id, item: null, ops })
  return folded === null ? ops : [...ops, ...BacklogOps.diff(folded, item)]
}

/** Stamps the ops of one item in order: never earlier than the op before it, so equal times keep their order. */
const stampOps = (input: {
  readonly item: BacklogItem
  readonly itemId: string
  readonly host: string
  readonly ops: readonly BacklogOp[]
}): BacklogOpRecord[] => {
  let previous: Hlc | null = null
  return input.ops.map(op => {
    const hlc = BacklogOps.nextHlc({ previous, now: opTime(input.item, op), host: input.host })
    previous = hlc
    return { opId: ulid(hlc.wall), itemId: input.itemId, hlc, origin: originOf(input.item, op), op }
  })
}

const originOf = (item: BacklogItem, op: BacklogOp): string => {
  if (op.kind === 'event' || op.kind === 'comment') return op.event.actor
  if (op.kind === 'create') return op.event?.actor ?? BacklogItems.creatorOf(item) ?? 'user'
  return 'system'
}

export interface LegacyImportItem {
  readonly legacyId: number
  readonly itemId: string
  readonly item: BacklogItem
  readonly records: readonly BacklogOpRecord[]
}

export interface LegacyImportPlan {
  readonly items: readonly LegacyImportItem[]
  readonly files: readonly { readonly itemId: string; readonly attachment: BacklogAttachment; readonly data: string }[]
  /** Files whose item no longer exists: left in the JSON domain, not imported. */
  readonly orphanFiles: number
  readonly mappings: readonly (readonly [string, SyncMapping])[]
  readonly nextId: number
}

/** Turns the JSON domains into what the SQLite store writes: no I/O, so a rehearsal can inspect it before anything lands. */
const plan = (input: { readonly snapshot: LegacySnapshot; readonly host: string }): LegacyImportPlan => {
  const items = [...input.snapshot.items]
    .sort((left, right) => left.id - right.id)
    .map(legacy => {
      const item = normalized(legacy)
      const itemId = ulid(item.createdAt)
      return { legacyId: item.id, itemId, item, records: stampOps({ item, itemId, host: input.host, ops: itemOps(item) }) }
    })
  const itemIds = new Map(items.map(entry => [entry.legacyId, entry.itemId]))
  const files = input.snapshot.files.flatMap(file => {
    const itemId = itemIds.get(file.itemId)
    return itemId === undefined ? [] : [{ itemId, attachment: file.attachment, data: file.data }]
  })
  const largest = Math.max(0, ...items.map(entry => entry.legacyId))
  return {
    items,
    files,
    orphanFiles: input.snapshot.files.length - files.length,
    mappings: input.snapshot.mappings,
    nextId: Math.max(input.snapshot.nextId ?? 1, largest + 1),
  }
}

export class LegacyImport {
  static readonly plan = plan
}
