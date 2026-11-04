import type { ChatReference } from './chat-reference.js'

/** What one `referenceTitles` Host call answers for a reference. */
export interface ChatReferenceTitleRow {
  readonly value: string
  readonly kind: 'revision' | 'bookmark'
  readonly title: string | null
  readonly root: string | null
}

export type ChatReferenceTitleLoader = (input: {
  readonly paths: readonly string[]
  readonly references: readonly ChatReference[]
}) => Promise<{ readonly titles: readonly ChatReferenceTitleRow[] }>

/** A reference's title state: still loading, or settled with the repository that resolved it (null when none did). */
export type ChatReferenceTitleEntry =
  | { readonly state: 'pending' }
  | { readonly state: 'settled'; readonly title: string | undefined; readonly targetPath: string | null }

const BATCH_LIMIT = 100

interface Queued {
  readonly paths: readonly string[]
  readonly references: Map<string, { readonly key: string; readonly reference: ChatReference }>
}

const referenceKey = (reference: ChatReference): string =>
  `${reference.kind}:${reference.kind === 'revision' ? reference.value.toLocaleLowerCase() : reference.value}`

const entryKey = (sessionId: string, cwd: string, reference: ChatReference): string => `${sessionId}\u0000${cwd}\u0000${referenceKey(reference)}`

/**
 * Titles of the `jj:` chips on screen. Every chip a render pass mounts asks here; the asks wait one frame and leave as a
 * single `referenceTitles` Host request per repository set (one per thread, normally), instead of one request (and five
 * jj reads) per chip. A settled title is kept for the page's life; the preview card can settle a reference the batch
 * could not resolve, such as a revision of another registered repository.
 */
export class ChatReferenceTitleStore {
  private readonly entries = new Map<string, ChatReferenceTitleEntry>()
  private readonly queue = new Map<string, Queued>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private scheduled = false

  constructor(
    private readonly options: {
      readonly load: ChatReferenceTitleLoader
      /** The registered project a thread belongs to, tried before its working directory. */
      readonly projectPathForSession: (sessionId: string) => string | undefined
      /** Defaults to the next animation frame, so every chip of one render pass shares a request. */
      readonly schedule?: (flush: () => void) => void
    },
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getVersion = (): number => this.version

  get(sessionId: string, cwd: string, reference: ChatReference): ChatReferenceTitleEntry | undefined {
    return this.entries.get(entryKey(sessionId, cwd, reference))
  }

  /** Ask for a title once; later asks for the same reference in the same thread and folder are free. */
  request(sessionId: string, cwd: string, reference: ChatReference): void {
    const key = entryKey(sessionId, cwd, reference)
    if (this.entries.has(key)) return
    this.entries.set(key, { state: 'pending' })
    const projectPath = this.options.projectPathForSession(sessionId)
    const paths = projectPath === undefined || projectPath === cwd ? [cwd] : [projectPath, cwd]
    const pathsKey = paths.join('\u0000')
    const queued = this.queue.get(pathsKey) ?? { paths, references: new Map() }
    queued.references.set(key, { key, reference })
    this.queue.set(pathsKey, queued)
    this.schedule()
  }

  /** Settle a reference from another read (the preview card found its repository). */
  record(sessionId: string, cwd: string, reference: ChatReference, settled: { readonly title: string; readonly targetPath: string | null }): void {
    this.entries.set(entryKey(sessionId, cwd, reference), { state: 'settled', title: settled.title, targetPath: settled.targetPath })
    this.notify()
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    const run = (): void => {
      this.scheduled = false
      void this.flush()
    }
    if (this.options.schedule !== undefined) this.options.schedule(run)
    else if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run)
    else setTimeout(run, 0)
  }

  private async flush(): Promise<void> {
    const groups = [...this.queue.values()]
    this.queue.clear()
    await Promise.all(
      groups.flatMap(group => {
        const items = [...group.references.values()]
        const batches: (typeof items)[] = []
        for (let index = 0; index < items.length; index += BATCH_LIMIT) batches.push(items.slice(index, index + BATCH_LIMIT))
        return batches.map(batch => this.load(group.paths, batch))
      }),
    )
  }

  private async load(paths: readonly string[], batch: readonly { readonly key: string; readonly reference: ChatReference }[]): Promise<void> {
    let rows: readonly ChatReferenceTitleRow[] = []
    try {
      rows = (await this.options.load({ paths, references: batch.map(item => item.reference) })).titles
    } catch {
      // An unreadable batch shows its references by name; nothing retries until the page reloads.
    }
    for (const item of batch) {
      const row = rows.find(candidate => candidate.kind === item.reference.kind && candidate.value === item.reference.value)
      const current = this.entries.get(item.key)
      // The preview card may have settled it meanwhile, with a repository this batch never tried.
      if (current?.state === 'settled') continue
      this.entries.set(item.key, { state: 'settled', title: row?.title ?? undefined, targetPath: row?.root ?? null })
    }
    this.notify()
  }

  private notify(): void {
    this.version += 1
    for (const listener of [...this.listeners]) listener()
  }
}
