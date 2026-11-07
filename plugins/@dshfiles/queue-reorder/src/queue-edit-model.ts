import { jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

/**
 * The shapes the queued-message editor reads and persists.
 *
 * DSH 0.2 can only replace a queued message's text, so attachments cannot survive an in-place edit. The editor takes
 * the message out of the queue, puts its text and attachments into the composer, and remembers where it stood — that
 * record is decoded here once and kept across a reload.
 */

const imageAttachmentSchema = Schema.Struct({
  attachmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  mediaType: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512))),
})

const fileAttachmentSchema = Schema.Struct({
  attachmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  bytes: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})

const queuedBlockSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('image'), attachment: imageAttachmentSchema }),
  Schema.Struct({ type: Schema.Literal('file'), attachment: fileAttachmentSchema }),
])

const looseBlockSchema = Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })

const queuedRowSourceSchema = Schema.Struct({ rpcId: Schema.optionalKey(Schema.String) })

const inboxSchema = Schema.Struct({ 'next-turn': Schema.Unknown })

export type QueuedBlock = typeof queuedBlockSchema.Type
export type QueuedImageAttachment = typeof imageAttachmentSchema.Type
export type QueuedFileAttachment = typeof fileAttachmentSchema.Type

export interface QueuedRow {
  readonly id: string
  /** Every block, decoded loosely, for previews. */
  readonly content: readonly (typeof looseBlockSchema.Type)[]
  /** The blocks the composer can hold; complete only when `editable`. */
  readonly blocks: readonly QueuedBlock[]
  readonly editable: boolean
  /** The prompt request that queued this message, when it came from a composer or this editor. */
  readonly rpcId: string | undefined
}

const decodeBlocks = (value: JsonValue | undefined): readonly QueuedBlock[] => {
  const items = Schema.decodeUnknownOption(Schema.Array(jsonValueSchema))(value)
  if (Option.isNone(items)) return []
  return items.value.flatMap(block =>
    Option.match(Schema.decodeUnknownOption(queuedBlockSchema)(block), {
      onNone: () => [],
      onSome: decoded => [decoded],
    }),
  )
}

const decodeLooseBlocks = (value: JsonValue | undefined): readonly (typeof looseBlockSchema.Type)[] => {
  const items = Schema.decodeUnknownOption(Schema.Array(jsonValueSchema))(value)
  if (Option.isNone(items)) return []
  return items.value.flatMap(block =>
    Option.match(Schema.decodeUnknownOption(looseBlockSchema)(block), {
      onNone: () => [],
      onSome: decoded => [decoded],
    }),
  )
}

const decodeQueuedRow = (value: JsonValue): QueuedRow | undefined => {
  const object = Schema.decodeUnknownOption(Schema.Record(Schema.String, jsonValueSchema))(value)
  if (Option.isNone(object)) return undefined
  const fields = object.value
  const id = Schema.decodeUnknownOption(Schema.String.check(Schema.isMinLength(1)))(fields['id'])
  if (Option.isNone(id)) return undefined
  const rawContent = Schema.decodeUnknownOption(Schema.Array(jsonValueSchema))(fields['content'])
  const blocks = decodeBlocks(fields['content'])
  const source = Schema.decodeUnknownOption(queuedRowSourceSchema)(fields['source'])
  return {
    id: id.value,
    content: decodeLooseBlocks(fields['content']),
    blocks,
    editable: blocks.length > 0 && blocks.length === (Option.isSome(rawContent) ? rawContent.value.length : 0),
    rpcId: Option.isSome(source) ? source.value.rpcId : undefined,
  }
}

/** Decode the Host `inbox` projection once, tolerating fields an older or newer Host shapes differently. */
export const decodeQueuedRows = (value: unknown): readonly QueuedRow[] => {
  const inbox = Schema.decodeUnknownOption(inboxSchema)(value)
  if (Option.isNone(inbox)) return []
  const items = Schema.decodeUnknownOption(Schema.Array(jsonValueSchema))(inbox.value['next-turn'])
  if (Option.isNone(items)) return []
  return items.value.flatMap(raw => {
    const row = decodeQueuedRow(raw)
    return row === undefined ? [] : [row]
  })
}

export const editRecordSchema = Schema.Struct({
  itemId: Schema.String,
  blocks: Schema.Array(queuedBlockSchema),
  /** Ids queued ahead of the message when editing began; its position is "after whichever of these remain". */
  before: Schema.Array(Schema.String),
  /** The composer draft the edit displaced, put back when the edit ends. */
  backupDraft: Schema.String,
  status: Schema.Literals(['editing', 'submitting', 'restoring', 'failed']),
  /** Composer submissions seen while editing; the first to reach the queue is the edited message. */
  submissions: Schema.Array(Schema.String),
  restoreRequestId: Schema.optional(Schema.String),
  composerRestored: Schema.Boolean,
  error: Schema.optional(Schema.String),
})

export const queueEditRecordsSchema = Schema.Record(Schema.String, editRecordSchema)

export type QueueEditRecord = typeof editRecordSchema.Type

/** A prompt part: plain text, or an attachment the composer serialized (opaque to the editor). */
export type PromptPart<Attachment> = { readonly type: 'text'; readonly text: string } | Attachment

export interface Observable<Value> {
  getSnapshot(): Value
  subscribe(listener: () => void): () => void
}

export interface ComposerSnapshot<DraftId extends string> {
  readonly draft: string
  readonly attachmentIds: readonly DraftId[]
  /** False while the composer is adjudicating or sending and refuses edits. */
  readonly idle: boolean
}

/** One queued image token located in the composer's plain-text document. */
export interface ImageReferenceToken<DraftId extends string> {
  readonly id: DraftId
  readonly label: string
  readonly offset: number
  readonly length: number
}

/** Pair each [Image N] token with the image attachment that produced it, in document order. */
const imageReferenceTokens = <DraftId extends string>(input: {
  readonly text: string
  readonly imageIds: readonly DraftId[]
}): readonly ImageReferenceToken<DraftId>[] => {
  const tokens = [...input.text.matchAll(/\[Image (\d+)\]/gu)]
  return tokens.flatMap((token, index) => {
    const id = input.imageIds[index]
    if (id === undefined) return []
    return [{ id, label: `Image ${token[1]}`, offset: token.index, length: token[0].length }]
  })
}

/** The hydrated ids of a row's image blocks, in attachment order. */
const imageIdsForBlocks = <DraftId extends string>(input: {
  readonly blocks: readonly QueuedBlock[]
  readonly attachmentIds: readonly DraftId[]
}): readonly DraftId[] => {
  let attachmentIndex = 0
  return input.blocks.flatMap(block => {
    if (block.type === 'text') return []
    const id = input.attachmentIds[attachmentIndex]
    attachmentIndex += 1
    return block.type === 'image' && id !== undefined ? [id] : []
  })
}

/** Everything the editor touches, so a test can supply a working in-memory world. */
export interface QueueEditPorts<DraftId extends string, Attachment> {
  readonly queue: Observable<readonly QueuedRow[]>
  readonly pendingRequestIds: Observable<readonly string[]>
  readonly composer: Observable<ComposerSnapshot<DraftId>> & {
    setDraft(text: string): void
    addAttachments(ids: readonly DraftId[]): boolean
    /** Replace queued [Image N] tokens with live attachment reference chips. */
    restoreImageReferences(input: { readonly text: string; readonly imageIds: readonly DraftId[] }): void
    removeAttachment(id: DraftId): void
    submit(): void
    focus(): void
  }
  readonly drafts: {
    create(files: readonly File[]): readonly DraftId[]
    release(ids: readonly DraftId[]): void
    /** The ids that still name a live draft attachment. */
    live(ids: readonly DraftId[]): readonly DraftId[]
    /** Wire payloads in id order, after every file upload finished. */
    serialize(ids: readonly DraftId[]): Promise<readonly Attachment[]>
  }
  readonly host: {
    readImage(attachment: QueuedImageAttachment): Promise<File>
    readFile(attachment: QueuedFileAttachment): Promise<File>
    /** Reject when the message is no longer pending. */
    remove(itemId: string): Promise<void>
    /** Queue one message and answer with its prompt request id. */
    enqueue(parts: readonly PromptPart<Attachment>[]): Promise<string>
    /** Move one step and answer with the new index. */
    move(itemId: string, direction: 'up' | 'down'): Promise<number>
  }
  readonly records: {
    load(): QueueEditRecord | null
    save(record: QueueEditRecord | null): void
  }
  /** Grace between a submission leaving the pending list and judging where it went. */
  readonly settleDelayMs?: number
  /** How long a sent message may take to show up in the queue before it counts as started directly. */
  readonly placementTimeoutMs?: number
}

/** Where the edited message goes back: after every message that was ahead of it and is still queued. */
const restoredIndex = (input: { readonly rows: readonly QueuedRow[]; readonly before: readonly string[]; readonly itemId?: string }): number => {
  const ahead = new Set(input.before)
  return input.rows.filter(row => row.id !== input.itemId && ahead.has(row.id)).length
}

/** The message's parts in block order, each attachment block replaced by its serialized upload. */
const promptPartsFor = <Attachment>(blocks: readonly QueuedBlock[], attachments: readonly Attachment[]): PromptPart<Attachment>[] => {
  let attachmentIndex = 0
  const parts = blocks.flatMap((block): PromptPart<Attachment>[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }]
    const attachment = attachments[attachmentIndex]
    attachmentIndex += 1
    return attachment === undefined ? [] : [attachment]
  })
  if (attachmentIndex !== attachments.length || parts.length !== blocks.length) throw new Error('attachments did not serialize')
  return parts
}

const textOf = (blocks: readonly QueuedBlock[]): string => blocks.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')

const messageOf = (error: unknown): string => (error instanceof Error && error.message.length > 0 ? error.message : 'unknown error')

/** What the composer's edit bar renders. */
export interface QueueEditView {
  readonly record: QueueEditRecord | null
  readonly loading: boolean
  readonly notice: string | null
}

/** The decoded shapes and the handful of derivations the editor and its machine share. */
export class QueueEditModel {
  static readonly decodeQueuedRows = decodeQueuedRows
  static readonly restoredIndex = restoredIndex
  static readonly promptPartsFor = promptPartsFor
  static readonly textOf = textOf
  static readonly imageReferenceTokens = imageReferenceTokens
  static readonly imageIdsForBlocks = imageIdsForBlocks
  static readonly messageOf = messageOf
  static readonly retainsSession = (view: QueueEditView): boolean => view.loading || view.record !== null
}
