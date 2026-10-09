import { boundedSummary } from './bounded-summary.ts'
import { MemoryError } from './memory-error.ts'
import { normalizeEvent } from './normalize-event.ts'
import { Scopes } from './scopes.ts'
import { TreeMath } from './tree-math.ts'
import type {
  AppendedEvent,
  Clock,
  EventRole,
  MemoryAccess,
  MemoryConfig,
  MemoryEvent,
  MemoryEventInput,
  MemoryLogger,
  MemoryNode,
  MemoryScope,
  MemorySearch,
  MemoryStore,
  NodeAddress,
  Snapshot,
  StreamId,
  Summarizer,
  ViewKind,
  ViewState,
} from './types.ts'
import { Utf8 } from './utf8.ts'
import { ViewMath } from './view-math.ts'

export const defaultMemoryConfig: MemoryConfig = {
  maxNodeBytes: 512,
  viewUpperBytes: 128_000,
  viewLowerBytes: 64_000,
  concurrency: 4,
  summaryRetries: 3,
  barrierMs: 5_000,
  toolResultMaxBytes: 16_384,
  eventMaxBytes: 262_144,
  compactUpperBytes: 8_192,
  compactLowerBytes: 4_096,
  pendingTailBytes: 16_384,
  summaryTimeoutMs: 60_000,
  retryBaseMs: 1_000,
  retryMaxMs: 60_000,
  zoomPageBytes: 8_192,
  contextEventBytes: 1_024,
  redactLiterals: [],
  excludeTools: [],
}

export type MemoryEngineOptions = {
  readonly store: MemoryStore
  readonly summarizer: Summarizer
  readonly search?: MemorySearch | undefined
  readonly clock?: Clock | undefined
  readonly logger?: MemoryLogger | undefined
  readonly config?: Partial<MemoryConfig> | undefined
  /** Called after every committed view write; must not throw. */
  readonly onViewCommitted?: ((event: { readonly stream: StreamId; readonly kind: ViewKind; readonly version: number }) => void) | undefined
}

export type ViewSnapshot = {
  readonly stream: StreamId
  readonly kind: ViewKind
  readonly version: number
  readonly throughPos: number
  readonly bytes: number
  readonly mergePending: boolean
  /** One rendered line per view node, aligned with `nodes`. */
  readonly nodes: readonly NodeAddress[]
  readonly lines: readonly string[]
}

export type AppendResult = { readonly events: readonly AppendedEvent[]; readonly inserted: number }

export type ZoomResult =
  | { readonly kind: 'node'; readonly stream: StreamId; readonly address: string; readonly lines: readonly string[] }
  | {
      readonly kind: 'event'
      readonly stream: StreamId
      readonly address: string
      readonly eventId: number
      readonly conversationId: string
      readonly role: EventRole
      readonly createdAt: number
      readonly truncated: boolean
      readonly page: number
      readonly pageCount: number
      readonly text: string
    }

export type ContextEntry = {
  readonly pos: number
  readonly address: string
  readonly eventId: number
  readonly conversationId: string
  readonly role: EventRole
  readonly createdAt: number
  readonly text: string
  readonly clipped: boolean
}

export type ContextResult = { readonly stream: StreamId; readonly center: number; readonly entries: readonly ContextEntry[] }

export type MemorySearchHit = {
  readonly eventId: number
  readonly conversationId: string
  readonly projectId: string | null
  readonly role: EventRole
  readonly createdAt: number
  readonly snippet: string
  readonly stream: StreamId | null
  readonly pos: number | null
  /** Leaf address `pos+1`, zoomable for the full event. */
  readonly address: string | null
  /** The line of the persisted view that currently covers the hit. */
  readonly viewAddress: string | null
}

export type StreamStatus = {
  readonly stream: StreamId
  readonly length: number
  readonly viewThroughPos: number
  readonly viewBytes: number
  readonly viewLines: number
  readonly viewVersion: number
  readonly mergePending: boolean
  readonly compactBytes: number
  readonly compactLines: number
}

export type MemoryStatus = {
  readonly streams: readonly StreamStatus[]
  readonly queue: { readonly leaves: number; readonly parents: number; readonly running: number; readonly parentsFirst: boolean }
  readonly failures: { readonly count: number; readonly lastError: string | null; readonly retryInMs: number | null }
  readonly summarizer: { readonly model: string; readonly calls: number; readonly clips: number }
  readonly merges: number
  readonly search: { readonly cursor: number; readonly lag: number; readonly error: string | null } | null
  readonly closed: boolean
}

export type MemoryEngine = {
  /** Recovery: resumes every pipeline from persisted cursors and views. */
  start(): Promise<void>
  append(inputs: readonly MemoryEventInput[]): Promise<AppendResult>
  /**
   * Next-turn barrier: waits up to `barrierMs` for leaves, then renders anything still pending raw. `endPos` takes the
   * snapshot as of that stream length, leaving later positions (the turn being answered) out of the pending tail.
   */
  snapshot(request: { readonly stream: StreamId; readonly barrierMs?: number | undefined; readonly endPos?: number | undefined }): Promise<Snapshot>
  /** The persisted view of one kind, without waiting for pending leaves. */
  readView(request: { readonly stream: StreamId; readonly kind: ViewKind }): Promise<ViewSnapshot>
  zoom(request: { readonly stream: StreamId; readonly address: string; readonly page?: number | undefined; readonly access: MemoryAccess }): Promise<ZoomResult>
  context(request: {
    readonly stream: StreamId
    readonly access: MemoryAccess
    readonly eventId?: number | undefined
    readonly pos?: number | undefined
    readonly before?: number | undefined
    readonly after?: number | undefined
  }): Promise<ContextResult>
  search(request: {
    readonly query: string
    readonly scope: MemoryScope
    readonly access: MemoryAccess
    readonly limit?: number | undefined
  }): Promise<readonly MemorySearchHit[]>
  status(): Promise<MemoryStatus>
  /** Resolves once queues, view maintenance and indexing are idle; failed jobs wait for the next append. */
  drain(): Promise<void>
  /** Stops scheduling and waits for in-flight work; queued work resumes on the next `start`. */
  close(): Promise<void>
}

type Job =
  | { readonly kind: 'leaf'; readonly stream: StreamId; readonly pos: number }
  | { readonly kind: 'parent'; readonly stream: StreamId; readonly address: NodeAddress }

class Fifo<Item> {
  #items: (Item | undefined)[] = []
  #head = 0

  get size(): number {
    return this.#items.length - this.#head
  }

  push(item: Item): void {
    this.#items.push(item)
  }

  shift(): Item | undefined {
    if (this.#head >= this.#items.length) return undefined
    const item = this.#items[this.#head]
    this.#items[this.#head] = undefined
    this.#head++
    if (this.#head > 1024 && this.#head * 2 > this.#items.length) {
      this.#items = this.#items.slice(this.#head)
      this.#head = 0
    }
    return item
  }
}

type CachedView = { readonly view: ViewState; readonly lines: readonly string[] }
type ViewRunner = { running: boolean; dirty: boolean }

const viewKinds: readonly ViewKind[] = ['main', 'compact']
const viewKey = (stream: StreamId, kind: ViewKind): string => `${kind}|${stream}`

const appendBatchSize = 4_096
const indexBatchSize = 1_000
const maxSearchLimit = 50

const jobKey = (job: Job): string => (job.kind === 'leaf' ? `L|${job.stream}|${job.pos}` : `P|${job.stream}|${TreeMath.key(job.address)}`)

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const withTimeout = <Value>(work: Promise<Value>, milliseconds: number, label: string): Promise<Value> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds)
    work.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

export const createMemoryEngine = (options: MemoryEngineOptions): MemoryEngine => {
  const config: MemoryConfig = { ...defaultMemoryConfig, ...options.config }
  const store = options.store
  const summarizer: Summarizer = {
    get model(): string {
      return options.summarizer.model
    },
    summarize: request => withTimeout(options.summarizer.summarize(request), config.summaryTimeoutMs, `${request.kind} summary ${request.address}`),
  }
  const searchIndex = options.search
  const clock: Clock = options.clock ?? { now: () => Date.now() }
  const logger: MemoryLogger = options.logger ?? { warn: () => {} }

  const leafQueue = new Fifo<Job>()
  const parentQueue = new Fifo<Job>()
  const queued = new Set<string>()
  const failed = new Map<string, Job>()
  const views = new Map<string, CachedView>()
  const pendingMerges = new Set<string>()
  const runners = new Map<StreamId, ViewRunner>()
  const leafTexts = new Map<number, Promise<{ readonly text: string; readonly model: string }>>()
  const viewWaiters: { readonly stream: StreamId; readonly pos: number; readonly resolve: () => void }[] = []
  const idleWaiters: (() => void)[] = []
  const quietWaiters: (() => void)[] = []
  let running = 0
  let closed = false
  let lastError: string | null = null
  let summaryCalls = 0
  let summaryClips = 0
  let merges = 0
  let indexing: Promise<void> | undefined
  let indexDirty = false
  let searchError: string | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryAt: number | null = null
  let consecutiveFailures = 0

  const cacheView = (cached: CachedView): void => {
    const key = viewKey(cached.view.stream, cached.view.kind)
    views.set(key, cached)
    if (cached.view.mergePending) pendingMerges.add(key)
    else pendingMerges.delete(key)
  }

  const forgetView = (stream: StreamId, kind: ViewKind): void => {
    views.delete(viewKey(stream, kind))
    pendingMerges.delete(viewKey(stream, kind))
  }

  const isQuiet = (): boolean => running === 0 && indexing === undefined && ![...runners.values()].some(runner => runner.running)
  const isIdle = (): boolean => isQuiet() && leafQueue.size === 0 && parentQueue.size === 0

  const checkIdle = (): void => {
    if (isQuiet()) for (const resolve of quietWaiters.splice(0)) resolve()
    if (isIdle()) for (const resolve of idleWaiters.splice(0)) resolve()
  }

  const recordFailure = (job: Job | undefined, error: unknown): void => {
    lastError = errorMessage(error)
    if (job) failed.set(jobKey(job), job)
    logger.warn('optmem pipeline step failed', { job: job ? jobKey(job) : 'view', error: lastError })
    if (job) scheduleRetry()
  }

  /** Failed jobs come back on an exponential backoff timer, not only on the next append. */
  const scheduleRetry = (): void => {
    if (retryTimer !== undefined || closed) return
    const delay = Math.min(config.retryMaxMs, config.retryBaseMs * 2 ** consecutiveFailures)
    consecutiveFailures++
    retryAt = clock.now() + delay
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      retryAt = null
      if (closed) return
      retryFailed()
      pump()
    }, delay)
  }

  const enqueue = (job: Job): void => {
    const key = jobKey(job)
    if (queued.has(key)) return
    queued.add(key)
    ;(job.kind === 'leaf' ? leafQueue : parentQueue).push(job)
  }

  const retryFailed = (): void => {
    for (const job of failed.values()) enqueue(job)
    failed.clear()
  }

  const pump = (): void => {
    while (!closed && running < config.concurrency) {
      // A blocked merge batch waits on parents, so they jump ahead of backlog leaves until it resolves.
      const job = pendingMerges.size > 0 ? (parentQueue.shift() ?? leafQueue.shift()) : (leafQueue.shift() ?? parentQueue.shift())
      if (!job) return
      running++
      runJob(job)
        .then(() => {
          consecutiveFailures = 0
        })
        .catch(error => recordFailure(job, error))
        .finally(() => {
          running--
          queued.delete(jobKey(job))
          pump()
          checkIdle()
        })
    }
  }

  const summarize = async (kind: 'leaf' | 'merge', stream: StreamId, address: NodeAddress, input: readonly string[]) => {
    const summary = await boundedSummary({
      summarizer,
      logger,
      kind,
      stream,
      address: TreeMath.format(address),
      input,
      maxBytes: config.maxNodeBytes,
      retries: config.summaryRetries,
    })
    summaryCalls += summary.calls
    if (summary.clipped) summaryClips++
    return summary
  }

  const leafText = (stream: StreamId, pos: number, event: MemoryEvent): Promise<{ readonly text: string; readonly model: string }> => {
    const verbatim = `${event.role}: ${event.text}`
    if (Utf8.byteLength(verbatim) <= config.maxNodeBytes) return Promise.resolve({ text: verbatim, model: 'verbatim' })
    const inflight = leafTexts.get(event.id)
    if (inflight) return inflight
    const pending = (async () => {
      const reused = await store.findLeafByEvent(event.id)
      if (reused) return { text: reused.text, model: reused.model }
      return summarize('leaf', stream, { level: 0, idx: pos }, [verbatim])
    })()
    leafTexts.set(event.id, pending)
    return pending.finally(() => leafTexts.delete(event.id))
  }

  const afterNodeSaved = async (stream: StreamId, address: NodeAddress): Promise<void> => {
    const waitingOnParents = viewKinds.some(kind => {
      const cached = views.get(viewKey(stream, kind))
      return !cached || cached.view.mergePending
    })
    if (address.level === 0 || waitingOnParents) markViewDirty(stream)
    const [sibling] = await store.getNodes(stream, [TreeMath.sibling(address)])
    if (sibling) enqueue({ kind: 'parent', stream, address: TreeMath.parent(address) })
  }

  const runJob = async (job: Job): Promise<void> => {
    const address = job.kind === 'leaf' ? { level: 0, idx: job.pos } : job.address
    const [existing] = await store.getNodes(job.stream, [address])
    if (existing) {
      if (job.kind === 'leaf') await afterNodeSaved(job.stream, address)
      return
    }
    const built = job.kind === 'leaf' ? await buildLeaf(job.stream, job.pos) : await buildParent(job.stream, job.address)
    if (!built) return
    await store.saveNode({ ...built, stream: job.stream, address, bytes: Utf8.byteLength(built.text), createdAt: clock.now() })
    await afterNodeSaved(job.stream, address)
  }

  const buildLeaf = async (stream: StreamId, pos: number) => {
    const [entry] = await store.readStream(stream, pos, pos + 1)
    if (!entry) return undefined
    const leaf = await leafText(stream, pos, entry.event)
    return { text: leaf.text, model: leaf.model, eventId: entry.event.id }
  }

  const buildParent = async (stream: StreamId, address: NodeAddress) => {
    const children = TreeMath.children(address)
    if (!children) return undefined
    const childNodes = await store.getNodes(stream, children)
    const left = childNodes.find(node => node.address.idx === children[0].idx)
    const right = childNodes.find(node => node.address.idx === children[1].idx)
    if (!left || !right) return undefined
    const joined = `${left.text}\n${right.text}`
    if (Utf8.byteLength(joined) <= config.maxNodeBytes) return { text: joined, model: 'concat', eventId: null }
    const summary = await summarize('merge', stream, address, [left.text, right.text])
    return { text: summary.text, model: summary.model, eventId: null }
  }

  const loadView = async (stream: StreamId, kind: ViewKind = 'main'): Promise<CachedView> => {
    const cached = views.get(viewKey(stream, kind))
    if (cached) return cached
    const view = (await store.getView(stream, kind)) ?? ViewMath.empty(stream, kind)
    const loaded = { view, lines: ViewMath.lines(view.rendered) }
    cacheView(loaded)
    return loaded
  }

  const bounds = (kind: ViewKind): { readonly upper: number; readonly lower: number } =>
    kind === 'main' ? { upper: config.viewUpperBytes, lower: config.viewLowerBytes } : { upper: config.compactUpperBytes, lower: config.compactLowerBytes }

  const maintainView = async (stream: StreamId, kind: ViewKind, runner: ViewRunner): Promise<void> => {
    const { view, lines: previousLines } = await loadView(stream, kind)
    const { upper, lower } = bounds(kind)
    const leaves = await store.listNodes(stream, 0, view.throughPos, view.throughPos + appendBatchSize)
    const appended: MemoryNode[] = []
    for (const leaf of leaves) {
      if (leaf.address.idx !== view.throughPos + appended.length) break
      appended.push(leaf)
    }
    const newLines = appended.map(leaf => ViewMath.line(leaf.address, leaf.text))
    const throughPos = view.throughPos + appended.length
    let nodes: readonly NodeAddress[] = [...view.nodes, ...appended.map(leaf => leaf.address)]
    let lines: readonly string[] = [...previousLines, ...newLines]
    let rendered = view.rendered + ViewMath.render(newLines)
    let bytes = view.bytes + newLines.reduce((sum, line) => sum + ViewMath.lineBytes(line), 0)
    let mergePending = view.mergePending
    let merged = 0
    if (bytes > upper || (mergePending && bytes > lower)) {
      const ancestors = await store.getNodes(stream, ViewMath.mergeAncestors(nodes, throughPos))
      const texts = new Map(ancestors.map(node => [TreeMath.key(node.address), node.text]))
      const plan = ViewMath.planMergeBatch({
        nodes,
        lines,
        bytes,
        throughPos,
        lowerBytes: lower,
        nodeText: address => texts.get(TreeMath.key(address)),
      })
      merged = plan.merges
      mergePending = !plan.reachedLower
      if (plan.merges > 0) {
        nodes = plan.nodes
        lines = plan.lines
        bytes = plan.bytes
        rendered = ViewMath.render(lines)
      }
    }
    if (appended.length === 0 && merged === 0 && mergePending === view.mergePending) return
    const next: ViewState = { stream, kind, throughPos, nodes, rendered, bytes, version: view.version + 1, mergePending }
    if (!(await store.commitView(next, view.version))) {
      forgetView(stream, kind)
      runner.dirty = true
      return
    }
    merges += merged
    cacheView({ view: next, lines })
    try {
      options.onViewCommitted?.({ stream, kind, version: next.version })
    } catch (error) {
      logger.warn('optmem view listener failed', { stream, kind, error: errorMessage(error) })
    }
    if (leaves.length === appendBatchSize) runner.dirty = true
    if (kind !== 'main') return
    for (let index = viewWaiters.length - 1; index >= 0; index--) {
      const waiter = viewWaiters[index]
      if (waiter && waiter.stream === stream && waiter.pos <= throughPos) {
        viewWaiters.splice(index, 1)
        waiter.resolve()
      }
    }
  }

  const markViewDirty = (stream: StreamId): void => {
    const runner = runners.get(stream) ?? { running: false, dirty: false }
    runners.set(stream, runner)
    runner.dirty = true
    if (runner.running || closed) return
    runner.running = true
    void (async () => {
      try {
        // One macrotask lets a burst of finished leaves land in a single view commit instead of one rewrite each.
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        while (runner.dirty && !closed) {
          runner.dirty = false
          for (const kind of viewKinds) await maintainView(stream, kind, runner)
        }
      } catch (error) {
        for (const kind of viewKinds) forgetView(stream, kind)
        recordFailure(undefined, error)
      } finally {
        runner.running = false
        checkIdle()
      }
    })()
  }

  const scheduleIndex = (): void => {
    if (!searchIndex || closed) return
    indexDirty = true
    if (indexing) return
    indexing = (async () => {
      while (indexDirty && !closed) {
        indexDirty = false
        try {
          let indexed = 1
          while (indexed > 0) indexed = (await searchIndex.indexPending({ limit: indexBatchSize })).indexed
          searchError = null
        } catch (error) {
          searchError = errorMessage(error)
        }
      }
    })().finally(() => {
      indexing = undefined
      checkIdle()
    })
  }

  const waitForView = (stream: StreamId, pos: number, timeoutMs: number): Promise<boolean> => {
    if ((views.get(viewKey(stream, 'main'))?.view.throughPos ?? 0) >= pos) return Promise.resolve(true)
    if (timeoutMs <= 0) return Promise.resolve(false)
    return new Promise(resolve => {
      const waiter = {
        stream,
        pos,
        resolve: () => {
          clearTimeout(timer)
          resolve(true)
        },
      }
      const timer = setTimeout(() => {
        const index = viewWaiters.indexOf(waiter)
        if (index >= 0) viewWaiters.splice(index, 1)
        resolve(false)
      }, timeoutMs)
      viewWaiters.push(waiter)
    })
  }

  const pendingLine = (pos: number, event: MemoryEvent): string =>
    `${pos}+1| [pending summary] ${ViewMath.escape(Utf8.clip(`${event.role}: ${event.text}`, config.maxNodeBytes))}`

  /** Keeps the newest lines within `pendingTailBytes`; older ones collapse into one explicit line, never silently. */
  const capPendingTail = (lines: readonly string[], firstPos: number): readonly string[] => {
    let bytes = 0
    let keepFrom = lines.length
    while (keepFrom > 0) {
      const lineBytes = ViewMath.lineBytes(lines[keepFrom - 1] ?? '')
      if (bytes + lineBytes > config.pendingTailBytes) break
      bytes += lineBytes
      keepFrom--
    }
    if (keepFrom === 0) return lines
    const marker = `${keepFrom} more pending events (positions ${firstPos}..${firstPos + keepFrom - 1}) — use memory_context`
    return [marker, ...lines.slice(keepFrom)]
  }

  const assertReadable = async (stream: StreamId, access: MemoryAccess): Promise<void> => {
    const conversationProject = stream.startsWith('conversation:') ? await store.conversationProject(stream.slice('conversation:'.length)) : undefined
    if (!Scopes.canRead(stream, access, conversationProject)) throw new MemoryError('scope-denied', `${stream} is outside this conversation's memory scope`)
  }

  const start = async (): Promise<void> => {
    closed = false
    for (const { stream, length } of await store.listStreams()) {
      const { view } = await loadView(stream)
      const { view: compact } = await loadView(stream, 'compact')
      for (const pos of await store.listMissingLeaves(stream, view.throughPos)) enqueue({ kind: 'leaf', stream, pos })
      for (const address of await store.listBuildableParents(stream)) enqueue({ kind: 'parent', stream, address })
      if (view.throughPos < length || view.mergePending || compact.throughPos < length || compact.mergePending) markViewDirty(stream)
    }
    scheduleIndex()
    pump()
  }

  const append = async (inputs: readonly MemoryEventInput[]): Promise<AppendResult> => {
    if (closed) throw new MemoryError('closed', 'memory engine is closed')
    const events = await store.appendEvents(inputs.map(input => normalizeEvent(input, config)))
    for (const event of events) for (const entry of event.entries) enqueue({ kind: 'leaf', stream: entry.stream, pos: entry.pos })
    retryFailed()
    pump()
    scheduleIndex()
    return { events, inserted: events.filter(event => event.inserted).length }
  }

  const snapshot: MemoryEngine['snapshot'] = async request => {
    const length = Math.min(await store.streamLength(request.stream), request.endPos ?? Number.POSITIVE_INFINITY)
    const { view: current } = await loadView(request.stream)
    let barrierTimedOut = false
    if (current.throughPos < length) {
      retryFailed()
      pump()
      markViewDirty(request.stream)
      barrierTimedOut = !(await waitForView(request.stream, length, request.barrierMs ?? config.barrierMs))
    }
    const stored = await store.readSnapshot(request.stream)
    const view = stored.view ?? ViewMath.empty(request.stream)
    const end = Math.min(stored.length, request.endPos ?? stored.length)
    const tail = end > view.throughPos ? await store.readStream(request.stream, view.throughPos, end) : []
    const viewText =
      end >= view.throughPos
        ? view.rendered
        : ViewMath.render(ViewMath.lines(view.rendered).filter((_line, index) => TreeMath.start(view.nodes[index] ?? { level: 0, idx: end }) < end))
    const builtLeaves = new Map((await store.listNodes(request.stream, 0, view.throughPos, stored.length)).map(node => [node.address.idx, node.text]))
    const pendingLines = tail.map(entry => {
      const built = builtLeaves.get(entry.pos)
      return built === undefined ? pendingLine(entry.pos, entry.event) : ViewMath.line({ level: 0, idx: entry.pos }, built)
    })
    const pending = ViewMath.render(capPendingTail(pendingLines, view.throughPos))
    const text = viewText + pending
    return {
      stream: request.stream,
      length: end,
      viewVersion: view.version,
      viewThroughPos: view.throughPos,
      view: viewText,
      pending,
      text,
      bytes: Utf8.byteLength(text),
      pendingCount: tail.filter(entry => !builtLeaves.has(entry.pos)).length,
      barrierTimedOut,
    }
  }

  const readView: MemoryEngine['readView'] = async request => {
    const { view, lines } = await loadView(request.stream, request.kind)
    return {
      stream: view.stream,
      kind: view.kind,
      version: view.version,
      throughPos: view.throughPos,
      bytes: view.bytes,
      mergePending: view.mergePending,
      nodes: view.nodes,
      lines,
    }
  }

  const zoom: MemoryEngine['zoom'] = async request => {
    await assertReadable(request.stream, request.access)
    const address = TreeMath.parse(request.address)
    if (!address)
      throw new MemoryError(
        'invalid-address',
        `"${request.address}" is not a node address; use <start>+<len> with len a power of 2 and start a multiple of len`,
      )
    const length = await store.streamLength(request.stream)
    if (!TreeMath.isComplete(address, length))
      throw new MemoryError('out-of-range', `${request.address} is past the end of ${request.stream} (${length} entries)`)
    const children = TreeMath.children(address)
    if (!children) {
      const [entry] = await store.readStream(request.stream, address.idx, address.idx + 1)
      if (!entry) throw new MemoryError('not-found', `no entry at ${request.address}`)
      const pages = Utf8.pages(`${entry.event.role}: ${entry.event.text}`, config.zoomPageBytes)
      const page = Math.min(Math.max(0, request.page ?? 0), pages.length - 1)
      return {
        kind: 'event',
        stream: request.stream,
        address: request.address,
        eventId: entry.event.id,
        conversationId: entry.event.conversationId,
        role: entry.event.role,
        createdAt: entry.event.createdAt,
        truncated: entry.event.truncated,
        page,
        pageCount: pages.length,
        text: pages[page] ?? '',
      }
    }
    const nodes = await store.getNodes(request.stream, children)
    const lines = await Promise.all(
      children.map(async child => {
        const node = nodes.find(candidate => candidate.address.idx === child.idx)
        if (node) return ViewMath.line(child, node.text)
        if (child.level > 0) return `${TreeMath.format(child)}| [not built yet: zoom deeper]`
        const [entry] = await store.readStream(request.stream, child.idx, child.idx + 1)
        return entry ? pendingLine(child.idx, entry.event) : `${TreeMath.format(child)}| [missing]`
      }),
    )
    return { kind: 'node', stream: request.stream, address: TreeMath.format(address), lines }
  }

  const context: MemoryEngine['context'] = async request => {
    await assertReadable(request.stream, request.access)
    let center = request.pos
    if (request.eventId !== undefined) {
      const entries = await store.findEntries(request.eventId)
      center = entries.find(entry => entry.stream === request.stream)?.pos
    }
    if (center === undefined) throw new MemoryError('not-found', `event is not part of ${request.stream}`)
    const length = await store.streamLength(request.stream)
    const from = Math.max(0, center - (request.before ?? 3))
    const to = Math.min(length, center + (request.after ?? 3) + 1)
    const events = await store.readStream(request.stream, from, to)
    return {
      stream: request.stream,
      center,
      entries: events.map(({ pos, event }) => {
        const text = Utf8.clip(event.text, config.contextEventBytes)
        return {
          pos,
          address: `${pos}+1`,
          eventId: event.id,
          conversationId: event.conversationId,
          role: event.role,
          createdAt: event.createdAt,
          text,
          clipped: text !== event.text,
        }
      }),
    }
  }

  const search: MemoryEngine['search'] = async request => {
    const stream = Scopes.stream(request.scope, request.access)
    if (!searchIndex) return []
    scheduleIndex()
    await indexing
    const hits = await searchIndex.search({ query: request.query, stream, limit: Math.min(Math.max(1, request.limit ?? 10), maxSearchLimit) })
    return Promise.all(
      hits.map(async hit => {
        const entry =
          stream === null
            ? (hit.entries.find(candidate => candidate.stream.startsWith('project:')) ?? hit.entries[0])
            : hit.entries.find(candidate => candidate.stream === stream)
        const viewNodes = entry ? (await loadView(entry.stream)).view.nodes : []
        const covering = entry ? viewNodes[TreeMath.covering(viewNodes, entry.pos)] : undefined
        return {
          eventId: hit.eventId,
          conversationId: hit.conversationId,
          projectId: hit.projectId,
          role: hit.role,
          createdAt: hit.createdAt,
          snippet: hit.snippet,
          stream: entry?.stream ?? null,
          pos: entry?.pos ?? null,
          address: entry ? `${entry.pos}+1` : null,
          viewAddress: covering ? TreeMath.format(covering) : null,
        }
      }),
    )
  }

  const status = async (): Promise<MemoryStatus> => {
    const streams = await Promise.all(
      (await store.listStreams()).map(async ({ stream, length }) => {
        const { view, lines } = await loadView(stream)
        const compact = await loadView(stream, 'compact')
        return {
          stream,
          length,
          viewThroughPos: view.throughPos,
          viewBytes: view.bytes,
          viewLines: lines.length,
          viewVersion: view.version,
          mergePending: view.mergePending,
          compactBytes: compact.view.bytes,
          compactLines: compact.lines.length,
        }
      }),
    )
    const searchStatus = searchIndex ? await searchIndex.status().catch(() => ({ cursor: -1, lag: -1 })) : undefined
    return {
      streams,
      queue: { leaves: leafQueue.size, parents: parentQueue.size, running, parentsFirst: pendingMerges.size > 0 },
      failures: { count: failed.size, lastError, retryInMs: retryAt === null ? null : Math.max(0, retryAt - clock.now()) },
      summarizer: { model: summarizer.model, calls: summaryCalls, clips: summaryClips },
      merges,
      search: searchStatus ? { ...searchStatus, error: searchError } : null,
      closed,
    }
  }

  const drain = (): Promise<void> => (isIdle() ? Promise.resolve() : new Promise(resolve => idleWaiters.push(resolve)))

  const close = (): Promise<void> => {
    closed = true
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    retryTimer = undefined
    retryAt = null
    return isQuiet() ? Promise.resolve() : new Promise(resolve => quietWaiters.push(resolve))
  }

  return { start, append, snapshot, readView, zoom, context, search, status, drain, close }
}
