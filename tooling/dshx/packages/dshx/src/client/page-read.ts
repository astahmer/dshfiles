interface PageRead {
  readonly startedAt: number
  readonly result: Promise<unknown>
}

const PAGE_READS_KEY = Symbol.for('@dshfiles/dshx.page-reads.v1')

/** Every plugin bundles its own dshx copy, so the reads in flight live on the page, keyed by what they read. */
const pageReads = (): Map<string, PageRead> => {
  // SAFETY: only this module writes the versioned symbol, and always this Map shape.
  const holder = globalThis as { [PAGE_READS_KEY]?: Map<string, PageRead> }
  holder[PAGE_READS_KEY] ??= new Map()
  return holder[PAGE_READS_KEY]
}

export interface JoinPageReadInput<Value> {
  /** Names the read and its input, e.g. `remote:session/modelCatalog`; one key always resolves to one value type. */
  readonly key: string
  readonly read: () => Promise<Value>
  /**
   * `performance.now()` of the Host change that asked for this read. A read that started before it may predate the
   * change, so it is not joined; a read that started at or after it is. Omit it for a plain load.
   */
  readonly notBefore?: number
}

/**
 * Join the identical read another owner on this page already has in flight, or start it. Native `ctx.remote` reads
 * (`session/modelCatalog`, `agentPresets/list`) bypass the dshx API coalescing, so owners that read the same core
 * method in the same burst share one request through this instead. Only reads still in flight are shared; a settled
 * read is never served again.
 */
const join = <Value>({ key, read, notBefore = Number.NEGATIVE_INFINITY }: JoinPageReadInput<Value>): Promise<Value> => {
  const reads = pageReads()
  const current = reads.get(key)
  if (current !== undefined && current.startedAt >= notBefore) {
    // SAFETY: a key names one Host method and input, so every read stored under it resolves to the same value type.
    return current.result as Promise<Value>
  }
  const startedAt = performance.now()
  const result = read()
  const entry: PageRead = { startedAt, result }
  const forget = (): void => {
    if (reads.get(key) === entry) reads.delete(key)
  }
  result.then(forget, forget)
  reads.set(key, entry)
  return result
}

export const PageReadModel = { join }
