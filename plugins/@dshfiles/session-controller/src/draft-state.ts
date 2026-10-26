import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import type { SessionCreateHandle, SessionDraft, SessionDrafts } from './draft-client.ts'

const metadataSchema = z.object({
  sessionId: z
    .string()
    .startsWith('session-')
    .transform(value => brandString<SessionId>(value)),
  workspaceId: z
    .string()
    .transform(value => brandString<WorkspaceId>(value))
    .optional(),
  cwd: z.string(),
  agentPreset: z.string().optional(),
  model: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }).optional(),
  preview: z.string().max(80),
})
function sameModel(left: { provider: string; model: string; reasoningEffort?: string | undefined }, right: ModelSelection | undefined): boolean {
  return right !== undefined && left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort
}

const draftsSchema = z.array(metadataSchema)
type DraftMetadata = z.output<typeof metadataSchema>

function modelSelectionOf(model: NonNullable<DraftMetadata['model']>): ModelSelection {
  const selection = { provider: model.provider, model: model.model }
  return model.reasoningEffort === undefined ? selection : { ...selection, reasoningEffort: model.reasoningEffort }
}

function draftOf(metadata: DraftMetadata, materialized: boolean): SessionDraft {
  let draft: SessionDraft = { sessionId: metadata.sessionId, preview: metadata.preview, local: !materialized }
  if (metadata.workspaceId !== undefined) draft = { ...draft, workspaceId: metadata.workspaceId }
  if (metadata.agentPreset !== undefined) draft = { ...draft, agentPreset: metadata.agentPreset }
  if (metadata.model !== undefined) draft = { ...draft, model: modelSelectionOf(metadata.model) }
  return draft
}

type DraftStorage = Pick<ReturnType<typeof createStoredValue<typeof draftsSchema>>, 'get' | 'set'>

export const createDraftStorage = (): DraftStorage => {
  const stored = createStoredValue({ key: 'dsh.sessionDrafts', schema: draftsSchema, fallback: [] })
  return {
    // A browser tab may not yet have received the other tab's storage event.
    // Merge against disk, not this StoredValue instance's cached snapshot.
    get: () => {
      stored.reload()
      return stored.get()
    },
    set: stored.set,
  }
}

interface DraftBackend {
  begin(opts: { cwd: string; sessionId?: SessionId }): SessionId
  defer(sessionId: SessionId, created: Promise<SessionId>, beforeRpc: (signal?: AbortSignal) => Promise<void>): void
  materialize(metadata: DraftMetadata): Promise<SessionId>
  selectModel?(sessionId: SessionId, selection: ModelSelection): Promise<void>
  selectPreset?(sessionId: SessionId, agentPreset: string): Promise<void>
  finish?(sessionId: SessionId): void
  discard?(sessionId: SessionId): void
  lookup?(sessionId: SessionId): DraftMetadata | undefined
  failed(sessionId: SessionId, error: unknown): void
}
interface DraftRecord {
  metadata: DraftMetadata
  readonly created: ReturnType<typeof Promise.withResolvers<SessionId>>
  attempt?: Promise<SessionId>
  error?: unknown
  materialized: boolean
  hostCreated: boolean
  appliedPreset?: string
  appliedModel?: ModelSelection
  revision: number
  hasContent: boolean
}

/** Waiter cancellation never cancels shared creation or the other references. */
async function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  const aborted = Promise.withResolvers<never>()
  const onAbort = (): void => {
    aborted.reject(signal.reason)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([promise, aborted.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Owns identities and materialization, never composer text or attachment bytes. */
export class ClientSessionDrafts implements SessionDrafts {
  readonly list = createSnapshotStore<Readonly<Record<string, SessionDraft>>>({})
  private readonly records = new Map<SessionId, DraftRecord>()
  private closed = false
  private readonly dirtyMetadata = new Set<SessionId>()
  private readonly retiredMetadata = new Set<SessionId>()
  private storageFailed = false

  constructor(
    private readonly backend: DraftBackend,
    private readonly storage = createDraftStorage(),
  ) {
    for (const metadata of storage.get()) this.add(metadata, true)
    this.publish()
  }

  create(opts: { workspaceId: WorkspaceId; cwd: string; agentPreset?: string }): SessionCreateHandle {
    if (this.closed) throw new Error('Session drafts disposed')
    const sessionId = this.backend.begin({ cwd: opts.cwd })
    const record = this.add({ ...opts, sessionId, preview: '' }, false, false)
    this.publish()
    return { sessionId, settled: record.created.promise }
  }

  update(sessionId: SessionId, content: { text: string; hasAttachments: boolean }): void {
    if (this.closed) return
    let record = this.records.get(sessionId)
    if (record === undefined) {
      const metadata = this.backend.lookup?.(sessionId)
      if (metadata === undefined) return
      const created = Promise.withResolvers<SessionId>()
      created.resolve(sessionId)
      record = { metadata, created, materialized: true, hostCreated: true, revision: 0, hasContent: false }
      this.records.set(sessionId, record)
    }
    const text = content.text.trim().replace(/\s+/gu, ' ')
    record.hasContent = text !== '' || content.hasAttachments
    const preview = text.slice(0, 80) || (content.hasAttachments ? 'Attachment draft' : '')
    if (record.metadata.preview !== preview) record.metadata = { ...record.metadata, preview }
    // Persist metadata before starting the Host call, including when it fails synchronously.
    this.dirtyMetadata.add(sessionId)
    this.persist()
    this.publish()
    if (record.hasContent && !record.materialized && record.attempt === undefined && record.error === undefined) {
      void this.materialize(record).catch(() => undefined)
    }
  }

  stageModel(sessionId: SessionId, selection: ModelSelection): boolean {
    const record = this.records.get(sessionId)
    if (this.closed || record === undefined || record.materialized) return false
    record.metadata = { ...record.metadata, model: { ...selection } }
    record.revision++
    this.dirtyMetadata.add(sessionId)
    this.persist()
    this.publish()
    return true
  }

  stagePreset(sessionId: SessionId, agentPreset: string): boolean {
    const record = this.records.get(sessionId)
    if (this.closed || record === undefined || record.materialized) return false
    record.metadata = { ...record.metadata, agentPreset }
    record.revision++
    this.dirtyMetadata.add(sessionId)
    this.persist()
    this.publish()
    return true
  }

  async whenCreated(sessionId: SessionId, signal?: AbortSignal): Promise<void> {
    const record = this.records.get(sessionId)
    if (record === undefined || record.materialized) return
    if (record.error !== undefined) throw record.error
    await waitFor(record.attempt ?? record.created.promise, signal)
  }

  retry(sessionId: SessionId): Promise<SessionId> {
    const record = this.records.get(sessionId)
    if (record === undefined || record.materialized) return Promise.resolve(sessionId)
    if (!record.hasContent) return record.created.promise
    return record.attempt ?? this.materialize(record)
  }

  /** Only Host-derived nonblank evidence retires unsent metadata. */
  reconcile(nonblank: ReadonlySet<SessionId>, hostIds: ReadonlySet<SessionId>): void {
    let changed = false
    for (const [id, record] of this.records) {
      // Added/list frames may precede our create response and staged selection writes.
      if (record.attempt !== undefined || record.error !== undefined) continue
      if (nonblank.has(id)) {
        this.records.delete(id)
        this.dirtyMetadata.delete(id)
        this.retiredMetadata.add(id)
        this.backend.finish?.(id)
        record.created.resolve(id)
        changed = true
      } else if (hostIds.has(id) && !record.materialized) {
        record.hostCreated = true
        if (record.metadata.model !== undefined || record.metadata.agentPreset !== undefined) {
          void this.materialize(record).catch(() => undefined)
        } else {
          record.materialized = true
          this.backend.finish?.(id)
          record.created.resolve(id)
          changed = true
        }
      }
    }
    if (changed) {
      this.persist()
      this.publish()
    }
  }

  /** Final local reference released: never keep abandoned empty identities or their success gates. */
  abandonEmpty(sessionId: SessionId): void {
    const record = this.records.get(sessionId)
    if (record === undefined || record.hasContent || record.materialized || record.attempt !== undefined) return
    this.records.delete(sessionId)
    this.dirtyMetadata.delete(sessionId)
    this.retiredMetadata.add(sessionId)
    this.backend.discard?.(sessionId)
    record.created.reject(new Error('Empty local draft was discarded'))
    this.persist()
    this.publish()
  }

  /** End local actors without erasing durable typed-draft metadata. */
  dispose(): void {
    this.closed = true
    for (const record of this.records.values()) record.created.reject(new Error('Session drafts disposed'))
    this.records.clear()
  }

  private add(metadata: DraftMetadata, hasContent: boolean, begin = true): DraftRecord {
    if (begin) this.backend.begin({ cwd: metadata.cwd, sessionId: metadata.sessionId })
    const created = Promise.withResolvers<SessionId>()
    void created.promise.catch(() => undefined)
    const record: DraftRecord = { metadata, created, materialized: false, hostCreated: false, revision: 0, hasContent }
    this.records.set(metadata.sessionId, record)
    this.backend.defer(metadata.sessionId, created.promise, async signal => {
      signal?.throwIfAborted()
      // A subsequent send is the explicit retry action. Blank waits do not create anything.
      if (record.error !== undefined && record.hasContent) void this.retry(metadata.sessionId).catch(() => undefined)
      await this.whenCreated(metadata.sessionId, signal)
    })
    return record
  }

  private materialize(record: DraftRecord): Promise<SessionId> {
    delete record.error
    const attempt = Promise.resolve()
      .then(async () => {
        const id = record.metadata.sessionId
        if (!record.hostCreated) {
          const requested = record.metadata
          const created = await this.backend.materialize(requested)
          if (created !== id) throw new Error('Draft creation returned a different Session identity')
          record.hostCreated = true
          if (requested.agentPreset !== undefined) record.appliedPreset = requested.agentPreset
        }
        // Choices can change while create/select is in flight. Drain only the latest values;
        // readiness and first-send admission stay behind this exact attempt's fence.
        let revision: number
        do {
          revision = record.revision
          const requested = record.metadata
          if (requested.agentPreset !== undefined && requested.agentPreset !== record.appliedPreset) {
            await this.backend.selectPreset?.(id, requested.agentPreset)
            record.appliedPreset = requested.agentPreset
            delete record.appliedModel
          }
          const model = requested.model
          if (model !== undefined && !sameModel(model, record.appliedModel)) {
            const selection = modelSelectionOf(model)
            await this.backend.selectModel?.(id, selection)
            record.appliedModel = selection
          }
        } while (revision !== record.revision)
        if (this.closed) throw new Error('Session drafts disposed')
        record.materialized = true
        this.backend.finish?.(id)
        this.persist()
        this.publish()
        record.created.resolve(id)
        return id
      })
      .catch((error: unknown) => {
        record.error = error
        this.backend.failed(record.metadata.sessionId, error)
        throw error
      })
      .finally(() => {
        if (record.attempt === attempt) delete record.attempt
      })
    record.attempt = attempt
    return attempt
  }

  private persist(): void {
    if (this.dirtyMetadata.size === 0 && this.retiredMetadata.size === 0) return
    const merged = new Map(this.storage.get().map(metadata => [metadata.sessionId, metadata]))
    for (const id of this.dirtyMetadata) {
      const record = this.records.get(id)
      if (record?.hasContent === true) merged.set(id, record.metadata)
      else merged.delete(id)
    }
    for (const id of this.retiredMetadata) merged.delete(id)
    if (this.storage.set([...merged.values()])) {
      this.dirtyMetadata.clear()
      this.retiredMetadata.clear()
      this.storageFailed = false
    } else if (!this.storageFailed) {
      this.storageFailed = true
      const error = new Error('Could not save draft metadata in browser storage. Keep this tab open to avoid losing the unsent draft on reload.')
      for (const id of this.dirtyMetadata) this.backend.failed(id, error)
    }
  }

  private publish(): void {
    this.list.set(Object.fromEntries([...this.records].map(([id, { metadata, materialized }]) => [id, draftOf(metadata, materialized)])))
  }
}
