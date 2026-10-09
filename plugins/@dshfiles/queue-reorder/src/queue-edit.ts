import { z } from 'zod'

/**
 * Editing a queued message in the main composer.
 *
 * DSH 0.2 can only replace a queued message's text, so attachments cannot survive an in-place edit. The editor
 * instead takes the message out of the queue, puts its text and attachments into the composer, and remembers where
 * it stood. Submit lets the composer send as usual and then moves the new queue entry back to that position; Cancel
 * sends the original content again and moves it back the same way.
 *
 * Taking the message out first is what makes races safe: once it is out, a finishing turn cannot run it while it is
 * being edited, and nothing else can send it twice. The record of the original is saved before the removal, so a
 * reload still offers Cancel.
 */

const imageAttachmentSchema = z.object({
  attachmentId: z.string().min(1).max(256),
  mediaType: z.string().min(1).max(128),
  name: z.string().max(512).optional(),
})

const fileAttachmentSchema = z.object({
  attachmentId: z.string().min(1).max(256),
  name: z.string().min(1).max(512),
  bytes: z.number().int().min(0),
})

const queuedBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), attachment: imageAttachmentSchema }),
  z.object({ type: z.literal('file'), attachment: fileAttachmentSchema }),
])

const looseBlockSchema = z.object({ type: z.string(), text: z.string().optional() })

const queuedRowSchema = z.object({
  id: z.string().min(1),
  content: z.array(z.unknown()).catch([]),
  source: z.object({ rpcId: z.string().optional() }).optional().catch(undefined),
})

const inboxSchema = z.object({ 'next-turn': z.array(z.unknown()).catch([]) })

export type QueuedBlock = z.infer<typeof queuedBlockSchema>
export type QueuedImageAttachment = z.infer<typeof imageAttachmentSchema>
export type QueuedFileAttachment = z.infer<typeof fileAttachmentSchema>

export interface QueuedRow {
  readonly id: string
  /** Every block, decoded loosely, for previews. */
  readonly content: readonly z.infer<typeof looseBlockSchema>[]
  /** The blocks the composer can hold; complete only when `editable`. */
  readonly blocks: readonly QueuedBlock[]
  readonly editable: boolean
  /** The prompt request that queued this message, when it came from a composer or this editor. */
  readonly rpcId: string | undefined
}

/** Decode the Host `inbox` projection once, tolerating fields an older or newer Host shapes differently. */
export const decodeQueuedRows = (value: unknown): readonly QueuedRow[] => {
  const inbox = inboxSchema.safeParse(value)
  if (!inbox.success) return []
  return inbox.data['next-turn'].flatMap(raw => {
    const row = queuedRowSchema.safeParse(raw)
    if (!row.success) return []
    const decoded = row.data.content.map(block => queuedBlockSchema.safeParse(block))
    const blocks = decoded.flatMap(result => (result.success ? [result.data] : []))
    const content = row.data.content.flatMap(block => {
      const loose = looseBlockSchema.safeParse(block)
      return loose.success ? [loose.data] : []
    })
    return [
      {
        id: row.data.id,
        content,
        blocks,
        editable: blocks.length > 0 && blocks.length === row.data.content.length,
        rpcId: row.data.source?.rpcId,
      },
    ]
  })
}

const editRecordSchema = z.object({
  itemId: z.string(),
  blocks: z.array(queuedBlockSchema),
  /** Ids queued ahead of the message when editing began; its position is "after whichever of these remain". */
  before: z.array(z.string()),
  /** The composer draft the edit displaced, put back when the edit ends. */
  backupDraft: z.string(),
  status: z.enum(['editing', 'submitting', 'restoring', 'failed']),
  /** Composer submissions seen while editing; the first to reach the queue is the edited message. */
  submissions: z.array(z.string()),
  restoreRequestId: z.string().optional(),
  composerRestored: z.boolean(),
  error: z.string().optional(),
})

export const queueEditRecordsSchema = z.record(z.string(), editRecordSchema)

export type QueueEditRecord = z.infer<typeof editRecordSchema>

/** A prompt part: plain text, or an attachment the composer serialized (opaque to the editor). */
export type PromptPart<Attachment> = { readonly type: 'text'; readonly text: string } | Attachment

interface Observable<Value> {
  getSnapshot(): Value
  subscribe(listener: () => void): () => void
}

export interface ComposerSnapshot<DraftId extends string> {
  readonly draft: string
  readonly attachmentIds: readonly DraftId[]
  /** False while the composer is adjudicating or sending and refuses edits. */
  readonly idle: boolean
}

/** Everything the editor touches, so a test can supply a working in-memory world. */
export interface QueueEditPorts<DraftId extends string, Attachment> {
  readonly queue: Observable<readonly QueuedRow[]>
  readonly pendingRequestIds: Observable<readonly string[]>
  readonly composer: Observable<ComposerSnapshot<DraftId>> & {
    setDraft(text: string): void
    addAttachments(ids: readonly DraftId[]): boolean
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

export interface QueueEditView {
  readonly record: QueueEditRecord | null
  readonly loading: boolean
  readonly notice: string | null
}

export interface QueueEditor {
  readonly getSnapshot: () => QueueEditView
  readonly subscribe: (listener: () => void) => () => void
  readonly begin: (row: QueuedRow) => Promise<void>
  readonly submit: () => void
  readonly cancel: () => Promise<void>
  /** Forget a failed restore; the original content is dropped. */
  readonly discard: () => void
  readonly dismissNotice: () => void
  readonly dispose: () => void
}

/** Where the edited message goes back: after every message that was ahead of it and is still queued. */
export const restoredIndex = (input: { readonly rows: readonly QueuedRow[]; readonly before: readonly string[]; readonly itemId?: string }): number => {
  const ahead = new Set(input.before)
  return input.rows.filter(row => row.id !== input.itemId && ahead.has(row.id)).length
}

const textOf = (blocks: readonly QueuedBlock[]): string => blocks.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')

const messageOf = (error: unknown): string => (error instanceof Error && error.message.length > 0 ? error.message : 'unknown error')

export const createQueueEditor = <DraftId extends string, Attachment>(ports: QueueEditPorts<DraftId, Attachment>): QueueEditor => {
  const settleDelayMs = ports.settleDelayMs ?? 600
  const placementTimeoutMs = ports.placementTimeoutMs ?? 10_000
  const listeners = new Set<() => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const placing = new Set<string>()
  // Browser-only state: draft ids and file bytes do not survive a reload, the record does.
  const fileCache = new Map<string, File>()
  let backupAttachmentIds: readonly DraftId[] = []
  let knownPending = new Set(ports.pendingRequestIds.getSnapshot())
  let disposed = false
  let view: QueueEditView = { record: ports.records.load(), loading: false, notice: null }

  const publish = (next: Partial<QueueEditView>): void => {
    view = { ...view, ...next }
    for (const listener of listeners) listener()
  }

  const saveRecord = (record: QueueEditRecord | null): void => {
    ports.records.save(record)
    publish({ record })
  }

  const later = (delayMs: number, run: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (!disposed) run()
    }, delayMs)
    timers.add(timer)
  }

  const loadFiles = async (blocks: readonly QueuedBlock[]): Promise<File[]> =>
    Promise.all(
      blocks.flatMap(block => {
        if (block.type === 'text') return []
        const cached = fileCache.get(block.attachment.attachmentId)
        if (cached !== undefined) return [Promise.resolve(cached)]
        const read = block.type === 'image' ? ports.host.readImage(block.attachment) : ports.host.readFile(block.attachment)
        return [
          read.then(file => {
            fileCache.set(block.attachment.attachmentId, file)
            return file
          }),
        ]
      }),
    )

  const placeItem = async (itemId: string, before: readonly string[]): Promise<void> => {
    const rows = ports.queue.getSnapshot()
    let index = rows.findIndex(row => row.id === itemId)
    if (index < 0) return
    const target = restoredIndex({ rows, before, itemId })
    // Bounded: each step moves one position, and a refused step answers with an unchanged index.
    for (let step = 0; step <= rows.length && index !== target; step += 1) {
      const next = await ports.host.move(itemId, index > target ? 'up' : 'down')
      if (next === index) return
      index = next
    }
  }

  const waitForQueued = (rpcId: string): Promise<QueuedRow | undefined> =>
    new Promise(resolve => {
      const find = (): QueuedRow | undefined => ports.queue.getSnapshot().find(row => row.rpcId === rpcId)
      const found = find()
      if (found !== undefined) return resolve(found)
      let settled = false
      const unsubscribe = ports.queue.subscribe(() => {
        const row = find()
        if (row === undefined || settled) return
        settled = true
        unsubscribe()
        resolve(row)
      })
      later(placementTimeoutMs, () => {
        if (settled) return
        settled = true
        unsubscribe()
        resolve(undefined)
      })
    })

  const restoreComposerBackup = (record: QueueEditRecord): void => {
    if (record.composerRestored) return
    if (ports.composer.getSnapshot().draft.trim().length === 0 && record.backupDraft.length > 0) ports.composer.setDraft(record.backupDraft)
    const live = ports.drafts.live(backupAttachmentIds)
    if (live.length > 0) ports.composer.addAttachments(live)
    backupAttachmentIds = []
  }

  const finishSubmit = (): void => {
    const record = view.record
    if (record === null) return
    saveRecord(null)
    restoreComposerBackup(record)
  }

  const placeSubmission = async (itemId: string, rpcId: string): Promise<void> => {
    const record = view.record
    if (record === null || placing.has(rpcId)) return
    placing.add(rpcId)
    try {
      await placeItem(itemId, record.before)
    } catch {
      // The message is queued either way; only its position is off, which the user can fix by dragging.
    } finally {
      placing.delete(rpcId)
    }
    finishSubmit()
  }

  const settle = (rpcId: string): void => {
    const record = view.record
    if (record === null || record.status !== 'submitting' || !record.submissions.includes(rpcId) || placing.has(rpcId)) return
    const row = ports.queue.getSnapshot().find(candidate => candidate.rpcId === rpcId)
    if (row !== undefined) {
      void placeSubmission(row.id, rpcId)
      return
    }
    const composer = ports.composer.getSnapshot()
    // An idle session runs a sent message at once and a steer skips the queue: delivered, nothing to place.
    if (composer.draft.trim().length === 0 && composer.attachmentIds.length === 0) {
      finishSubmit()
      return
    }
    const submissions = record.submissions.filter(id => id !== rpcId)
    saveRecord({
      ...record,
      status: submissions.length > 0 ? 'submitting' : 'editing',
      submissions,
      error: 'Submit did not go through; your edit is still in the composer.',
    })
  }

  const onQueue = (): void => {
    const record = view.record
    if (record === null || record.status !== 'submitting') return
    for (const row of ports.queue.getSnapshot()) {
      if (row.rpcId !== undefined && record.submissions.includes(row.rpcId)) void placeSubmission(row.id, row.rpcId)
    }
  }

  const onPending = (): void => {
    const current = new Set(ports.pendingRequestIds.getSnapshot())
    const record = view.record
    if (record !== null && (record.status === 'editing' || record.status === 'submitting')) {
      const fresh = [...current].filter(id => !knownPending.has(id) && !record.submissions.includes(id))
      if (fresh.length > 0) saveRecord({ ...record, status: 'submitting', submissions: [...record.submissions, ...fresh], error: undefined })
    }
    const retired = [...knownPending].filter(id => !current.has(id))
    knownPending = current
    for (const rpcId of retired) {
      if (view.record?.submissions.includes(rpcId) === true) later(settleDelayMs, () => settle(rpcId))
    }
    onQueue()
  }

  const begin = async (row: QueuedRow): Promise<void> => {
    if (view.record !== null || view.loading) return publish({ notice: 'Finish the queued message you are editing first.' })
    if (!row.editable) return publish({ notice: 'This queued message holds content the composer cannot edit.' })
    if (!ports.composer.getSnapshot().idle) return publish({ notice: 'Wait for the composer to finish sending, then edit.' })
    publish({ loading: true, notice: null })
    let files: File[]
    try {
      files = await loadFiles(row.blocks)
    } catch (error) {
      return publish({ loading: false, notice: `Could not load this message's attachments (${messageOf(error)}). It stays queued.` })
    }
    const rows = ports.queue.getSnapshot()
    const index = rows.findIndex(candidate => candidate.id === row.id)
    if (index < 0) return publish({ loading: false, notice: 'This message already left the queue.' })
    const composer = ports.composer.getSnapshot()
    const record: QueueEditRecord = {
      itemId: row.id,
      blocks: [...row.blocks],
      before: rows.slice(0, index).map(candidate => candidate.id),
      backupDraft: composer.draft,
      status: 'editing',
      submissions: [],
      composerRestored: false,
    }
    // Saved before the removal: a crash in between still leaves Cancel able to put the original back.
    ports.records.save(record)
    try {
      await ports.host.remove(row.id)
    } catch {
      ports.records.save(null)
      return publish({ loading: false, record: null, notice: 'This message already left the queue.' })
    }
    backupAttachmentIds = [...composer.attachmentIds]
    for (const id of backupAttachmentIds) ports.composer.removeAttachment(id)
    ports.composer.setDraft(textOf(row.blocks))
    const hydrated = ports.drafts.create(files)
    let notice: string | null = null
    if (hydrated.length > 0 && !ports.composer.addAttachments(hydrated)) {
      ports.drafts.release(hydrated)
      notice = 'The composer refused the attachments; Cancel still puts the original back.'
    }
    knownPending = new Set(ports.pendingRequestIds.getSnapshot())
    publish({ record, loading: false, notice })
    ports.composer.focus()
  }

  const submit = (): void => {
    if (view.record?.status === 'editing') ports.composer.submit()
  }

  const cancel = async (): Promise<void> => {
    const record = view.record
    if (record === null || (record.status !== 'editing' && record.status !== 'failed')) return
    let next: QueueEditRecord = { ...record, status: 'restoring', error: undefined }
    saveRecord(next)
    if (!record.composerRestored) {
      const edited = ports.composer.getSnapshot().attachmentIds
      for (const id of edited) ports.composer.removeAttachment(id)
      ports.drafts.release(edited)
      ports.composer.setDraft('')
      restoreComposerBackup(record)
      next = { ...next, composerRestored: true }
      saveRecord(next)
    }
    let draftIds: readonly DraftId[] = []
    let requestId: string
    try {
      draftIds = ports.drafts.create(await loadFiles(record.blocks))
      const attachments = await ports.drafts.serialize(draftIds)
      let attachmentIndex = 0
      const parts = record.blocks.flatMap((block): PromptPart<Attachment>[] => {
        if (block.type === 'text') return [{ type: 'text', text: block.text }]
        const attachment = attachments[attachmentIndex]
        attachmentIndex += 1
        return attachment === undefined ? [] : [attachment]
      })
      if (attachmentIndex !== attachments.length || parts.length !== record.blocks.length) throw new Error('attachments did not serialize')
      requestId = await ports.host.enqueue(parts)
    } catch (error) {
      return saveRecord({ ...next, status: 'failed', error: `Could not put the original message back (${messageOf(error)}). Retry or discard it.` })
    } finally {
      if (draftIds.length > 0) ports.drafts.release(draftIds)
    }
    saveRecord({ ...next, restoreRequestId: requestId })
    knownPending = new Set(ports.pendingRequestIds.getSnapshot())
    const row = await waitForQueued(requestId)
    if (row !== undefined) {
      try {
        await placeItem(row.id, record.before)
      } catch {
        // Queued again either way; only its position is off.
      }
    }
    if (view.record?.restoreRequestId === requestId) saveRecord(null)
  }

  const discard = (): void => {
    if (view.record?.status === 'failed') saveRecord(null)
  }

  const resume = async (record: QueueEditRecord): Promise<void> => {
    if (record.status === 'submitting') {
      for (const rpcId of record.submissions) later(settleDelayMs, () => settle(rpcId))
      return
    }
    if (record.status === 'restoring') {
      const requestId = record.restoreRequestId
      const row = requestId === undefined ? undefined : await waitForQueued(requestId)
      if (row !== undefined) {
        try {
          await placeItem(row.id, record.before)
        } catch {
          // Queued again either way.
        }
        return saveRecord(null)
      }
      return saveRecord({ ...record, status: 'failed', error: 'Putting the original back was interrupted. Check the queue, then retry or discard it.' })
    }
    // After a reload the composer kept the edited text but lost its attachments, which live only in the page.
    if (record.status !== 'editing' || ports.composer.getSnapshot().attachmentIds.length > 0) return
    if (!record.blocks.some(block => block.type !== 'text')) return
    try {
      const hydrated = ports.drafts.create(await loadFiles(record.blocks))
      if (!ports.composer.addAttachments(hydrated)) ports.drafts.release(hydrated)
    } catch {
      publish({ notice: "Could not reload this message's attachments into the composer; Cancel still puts the original back." })
    }
  }

  const unsubscribers = [ports.pendingRequestIds.subscribe(onPending), ports.queue.subscribe(onQueue)]
  if (view.record !== null) void resume(view.record)

  return {
    getSnapshot: () => view,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    begin,
    submit,
    cancel,
    discard,
    dismissNotice: () => publish({ notice: null }),
    dispose: () => {
      disposed = true
      for (const unsubscribe of unsubscribers) unsubscribe()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      listeners.clear()
    },
  }
}
