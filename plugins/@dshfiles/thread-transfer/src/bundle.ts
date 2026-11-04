/**
 * The `.dshthread` bundle: one thread's whole event log plus every attachment it references, in one portable file.
 *
 * - Attachments are content-addressed (`sha256:<hex>` of their exact bytes) and stored once, however often the log cites
 *   them; the log keeps the source machine's references and `references` maps each one to its content key, so the
 *   importing machine re-saves the bytes into its own attachment store and rewrites the references to the new ones.
 * - Nothing in the bundle is needed from the source machine to replay it: no Session id (the importer mints one), no
 *   working directory (the importer picks one; only the folder's base name is kept as a hint), no credential.
 * - `formatVersion` versions this file; `sessionFormat` is the DSH Session log format of `events`, so an importer on
 *   another DSH release refuses a log it would misread instead of guessing.
 *
 * Pure: no I/O. `encode`/`decode` (gzip of the JSON document) live in `bundle-codec.ts`.
 */
import { createHash } from 'node:crypto'
import { Option, Schema } from 'effect'

export const BUNDLE_FORMAT = 'dshthread'
export const BUNDLE_FORMAT_VERSION = 1
export const BUNDLE_EXTENSION = '.dshthread'

/** A JSON value as it appears inside a Session event. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** One Session log record, kept as plain JSON so the bundle never depends on a particular DSH build's event types. */
export interface BundleEvent {
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly data: JsonValue
  readonly [key: string]: JsonValue
}

const modelSchema = Schema.Struct({ provider: Schema.String, model: Schema.String, reasoningEffort: Schema.optional(Schema.String) })
export type BundleModel = typeof modelSchema.Type

const attachmentSchema = Schema.Struct({
  key: Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u)),
  kind: Schema.Literals(['image', 'file']),
  /** Image media type; absent for a file. */
  mediaType: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  /** Base64 of the exact bytes. */
  data: Schema.String,
})
export type BundleAttachment = typeof attachmentSchema.Type

export const bundleSchema = Schema.Struct({
  format: Schema.Literal(BUNDLE_FORMAT),
  formatVersion: Schema.Number.check(Schema.isInt()),
  exportedAt: Schema.Number,
  producer: Schema.Struct({ plugin: Schema.String, sessionFormat: Schema.Number.check(Schema.isInt()) }),
  thread: Schema.Struct({
    title: Schema.NullOr(Schema.String),
    createdAt: Schema.Number,
    agentPreset: Schema.optional(Schema.String),
    model: Schema.NullOr(modelSchema),
    /** Base name of the source working directory, a hint for the importer's folder choice; never a path. */
    folderName: Schema.NullOr(Schema.String),
    messageCount: Schema.Number,
  }),
  events: Schema.Array(Schema.Unknown),
  attachments: Schema.Array(attachmentSchema),
  /** Source attachment id → content key, for every reference the log carries. */
  references: Schema.Record(Schema.String, Schema.String),
  /** Source attachment ids the exporting machine could not read; their references stay as they were. */
  missingAttachments: Schema.Array(Schema.String),
})
export type ThreadBundle = typeof bundleSchema.Type

const eventEnvelope = Schema.Struct({ seq: Schema.Number.check(Schema.isInt()), type: Schema.String, time: Schema.Number, data: Schema.Unknown })

/** A reference to one stored attachment, as Session events carry them inside their content. */
export type AttachmentReference =
  | {
      readonly kind: 'image'
      readonly attachmentId: string
      readonly mediaType: string
      readonly bytes: number
      readonly width: number
      readonly height: number
      readonly name?: string
    }
  | { readonly kind: 'file'; readonly attachmentId: string; readonly name: string; readonly bytes: number }

const imageReference = Schema.Struct({
  attachmentId: Schema.String.check(Schema.isMinLength(1)),
  mediaType: Schema.String.check(Schema.isStartingWith('image/')),
  bytes: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  name: Schema.optional(Schema.String),
})
const fileReference = Schema.Struct({ attachmentId: Schema.String.check(Schema.isMinLength(1)), name: Schema.String, bytes: Schema.Number })

type JsonObject = { readonly [key: string]: JsonValue }

/** Session events arrive as parsed JSON (a stored log or a decoded bundle), so every object in them is a JSON object. */
const isRecord = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

const asReference = (value: JsonValue): AttachmentReference | undefined => {
  const image = Schema.decodeUnknownOption(imageReference)(value)
  if (Option.isSome(image)) {
    const { attachmentId, mediaType, bytes, width, height, name } = image.value
    const reference: AttachmentReference = { kind: 'image', attachmentId, mediaType, bytes, width, height }
    return name === undefined ? reference : { ...reference, name }
  }
  const file = Schema.decodeUnknownOption(fileReference)(value)
  if (Option.isSome(file) && isRecord(value) && !('mediaType' in value)) return { kind: 'file', ...file.value }
  return undefined
}

/** Visit every object nested in a JSON value, depth first. */
const walk = (value: JsonValue | undefined, visit: (object: JsonObject) => void): void => {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  if (!isRecord(value)) return
  visit(value)
  for (const child of Object.values(value)) walk(child, visit)
}

/** Every distinct attachment reference the events carry, by source attachment id, in first-seen order. */
const references = (events: readonly unknown[]): ReadonlyMap<string, AttachmentReference> => {
  const found = new Map<string, AttachmentReference>()
  for (const event of events)
    walk(isRecord(event) ? event['data'] : undefined, object => {
      const reference = asReference(object)
      if (reference !== undefined && !found.has(reference.attachmentId)) found.set(reference.attachmentId, reference)
    })
  return found
}

/** Replace each reference whose source id `replace` knows with the new one, keeping every other field of the object. */
const rewrite = (value: JsonValue, replace: ReadonlyMap<string, AttachmentReference>): JsonValue => {
  if (Array.isArray(value)) return value.map(item => rewrite(item, replace))
  if (!isRecord(value)) return value
  const reference = asReference(value)
  const next = reference === undefined ? undefined : replace.get(reference.attachmentId)
  const base = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child, replace)]))
  if (next === undefined || reference === undefined || next.kind !== reference.kind) return base
  // Only the identity the importing store assigned changes; names and any other field stay as the log recorded them.
  if (next.kind === 'file') return { ...base, attachmentId: next.attachmentId, bytes: next.bytes }
  return { ...base, attachmentId: next.attachmentId, mediaType: next.mediaType, bytes: next.bytes, width: next.width, height: next.height }
}

const contentKey = (data: Uint8Array): string => `sha256:${createHash('sha256').update(data).digest('hex')}`

const lastOf = <A>(events: readonly unknown[], type: string, decode: (data: JsonValue | undefined) => Option.Option<A>): A | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!isRecord(event) || event['type'] !== type) continue
    const decoded = decode(event['data'])
    if (Option.isSome(decoded)) return decoded.value
  }
  return null
}

const titleData = Schema.Struct({ title: Schema.String })
const userWritten = Schema.Struct({ source: Schema.Struct({ kind: Schema.Literal('user') }) })
const textPart = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String.check(Schema.isMinLength(1)) })
const assistantText = Schema.Struct({ message: Schema.Struct({ content: Schema.Array(Schema.Unknown) }) })
const answeredBy = Schema.Struct({ message: Schema.Struct({ source: Schema.Struct({ provider: Schema.String, model: Schema.String }) }) })

/** A message a reader sees: one the user wrote, or an assistant step that says something (not only tool calls). */
const isVisibleMessage = (event: JsonObject): boolean => {
  if (event['type'] === 'user/message') return Option.isSome(Schema.decodeUnknownOption(userWritten)(event['data']))
  if (event['type'] !== 'assistant/message') return false
  const decoded = Schema.decodeUnknownOption(assistantText)(event['data'])
  return Option.isSome(decoded) && decoded.value.message.content.some(part => Schema.is(textPart)(part))
}

/** The thread's latest title, model and how many messages a reader sees in it. */
const describe = (events: readonly unknown[]) => ({
  title: lastOf(events, 'session/title', data => Option.map(Schema.decodeUnknownOption(titleData)(data), decoded => decoded.title)),
  // An explicit selection, else the route that answered last.
  model:
    lastOf(events, 'model/selection', Schema.decodeUnknownOption(modelSchema)) ??
    lastOf(events, 'assistant/message', data => Option.map(Schema.decodeUnknownOption(answeredBy)(data), decoded => decoded.message.source)),
  messageCount: events.filter(isRecord).filter(isVisibleMessage).length,
})

const baseName = (path: string | undefined): string | null => {
  if (path === undefined) return null
  const parts = path.split(/[\\/]+/u).filter(part => part !== '')
  return parts.at(-1) ?? null
}

/** What an importer sees before committing: enough to recognize the thread, nothing it has to trust. */
export interface BundleSummary {
  readonly title: string | null
  readonly exportedAt: number
  readonly createdAt: number
  readonly eventCount: number
  readonly messageCount: number
  readonly attachmentCount: number
  readonly attachmentBytes: number
  readonly missingAttachments: number
  readonly model: BundleModel | null
  readonly folderName: string | null
  readonly sessionFormat: number
}

export class ThreadBundles {
  static readonly references = references
  static readonly contentKey = contentKey

  /** Whether the log holds a fork's inherited-prefix marker: such a log is stored as a seeded Session. */
  static isSeeded(events: readonly unknown[]): boolean {
    return events.filter(isRecord).some(event => event['type'] === 'session/end-seed')
  }

  /** Assemble a bundle from one Session's header facts, its events and the bytes of the attachments that could be read. */
  static build(input: {
    readonly createdAt: number
    readonly cwd: string | undefined
    readonly agentPreset: string | undefined
    readonly sessionFormat: number
    readonly events: readonly unknown[]
    readonly attachments: ReadonlyMap<string, { readonly reference: AttachmentReference; readonly data: Uint8Array }>
    readonly exportedAt: number
  }): ThreadBundle {
    const stored = new Map<string, BundleAttachment>()
    const map: Record<string, string> = {}
    const missing: string[] = []
    for (const [sourceId, reference] of references(input.events)) {
      const read = input.attachments.get(sourceId)
      if (read === undefined) {
        missing.push(sourceId)
        continue
      }
      const key = contentKey(read.data)
      map[sourceId] = key
      if (stored.has(key)) continue
      const base: BundleAttachment = { key, kind: reference.kind, bytes: read.data.byteLength, data: Buffer.from(read.data).toString('base64') }
      const typed = reference.kind === 'image' ? { ...base, mediaType: reference.mediaType } : base
      stored.set(key, reference.name === undefined ? typed : { ...typed, name: reference.name })
    }
    const described = describe(input.events)
    const thread: ThreadBundle['thread'] = {
      title: described.title,
      createdAt: input.createdAt,
      model: described.model,
      folderName: baseName(input.cwd),
      messageCount: described.messageCount,
    }
    return {
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_FORMAT_VERSION,
      exportedAt: input.exportedAt,
      producer: { plugin: '@dshfiles/thread-transfer', sessionFormat: input.sessionFormat },
      thread: input.agentPreset === undefined ? thread : { ...thread, agentPreset: input.agentPreset },
      events: input.events,
      attachments: [...stored.values()],
      references: map,
      missingAttachments: missing,
    }
  }

  static summary(bundle: ThreadBundle): BundleSummary {
    return {
      title: bundle.thread.title,
      exportedAt: bundle.exportedAt,
      createdAt: bundle.thread.createdAt,
      eventCount: bundle.events.length,
      messageCount: bundle.thread.messageCount,
      attachmentCount: bundle.attachments.length,
      attachmentBytes: bundle.attachments.reduce((total, attachment) => total + attachment.bytes, 0),
      missingAttachments: bundle.missingAttachments.length,
      model: bundle.thread.model,
      folderName: bundle.thread.folderName,
      sessionFormat: bundle.producer.sessionFormat,
    }
  }

  /**
   * Why this build cannot replay the bundle, or undefined when it can: another bundle version, another Session log
   * format, events that are not a contiguous log from seq 0, or an attachment whose bytes do not match its key.
   */
  static problem(bundle: ThreadBundle, sessionFormat: number): string | undefined {
    if (bundle.formatVersion !== BUNDLE_FORMAT_VERSION)
      return `This bundle uses thread format ${String(bundle.formatVersion)}; this DSH reads format ${String(BUNDLE_FORMAT_VERSION)}. Update @dshfiles/thread-transfer on the machine that is older, then export or import again.`
    if (bundle.producer.sessionFormat !== sessionFormat)
      return `This thread was exported from a DSH whose Session log format is ${String(bundle.producer.sessionFormat)}; this DSH uses format ${String(sessionFormat)}. Run the same DSH release on both machines, then export again.`
    for (const [index, event] of bundle.events.entries()) {
      const envelope = Schema.decodeUnknownOption(eventEnvelope)(event)
      if (Option.isNone(envelope)) return `Event ${String(index)} of the bundle is not a Session event; the file is damaged. Export the thread again.`
      if (envelope.value.seq !== index)
        return `The bundle's events are not one contiguous log (event ${String(index)} has seq ${String(envelope.value.seq)}); the file is damaged. Export the thread again.`
    }
    const keys = new Set(bundle.attachments.map(attachment => attachment.key))
    for (const key of Object.values(bundle.references))
      if (!keys.has(key)) return `The bundle cites attachment ${key} without its bytes; the file is damaged. Export the thread again.`
    for (const attachment of bundle.attachments)
      if (contentKey(Buffer.from(attachment.data, 'base64')) !== attachment.key)
        return `Attachment ${attachment.name ?? attachment.key} does not match its checksum; the file is damaged. Export the thread again.`
    return undefined
  }

  /**
   * The events to store on the importing machine: every attachment reference rewritten to the reference its bytes got
   * there (`saved`: content key → new reference). References with no new reference stay as they were.
   */
  static rebase(bundle: ThreadBundle, saved: ReadonlyMap<string, AttachmentReference>): unknown[] {
    const replace = new Map<string, AttachmentReference>()
    for (const [sourceId, key] of Object.entries(bundle.references)) {
      const next = saved.get(key)
      if (next !== undefined) replace.set(sourceId, next)
    }
    return bundle.events.map(event => {
      const data = isRecord(event) ? event['data'] : undefined
      return data === undefined || !isRecord(event) ? event : { ...event, data: rewrite(data, replace) }
    })
  }

  /** A file name for the bundle: the title's words, else the thread's date. */
  static fileName(bundle: ThreadBundle): string {
    const slug = (bundle.thread.title ?? '')
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60)
      .toLowerCase()
    const stem = slug === '' ? `thread-${new Date(bundle.thread.createdAt).toISOString().slice(0, 10)}` : slug
    return `${stem}${BUNDLE_EXTENSION}`
  }
}
