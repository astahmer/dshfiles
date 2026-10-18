import type { PendingUserQuestion } from '@deepseek-ai/dsh-user-questions'
import type { QuestionWaitRecord } from './question-wait-projection.js'

/** One Session a question scan may read, with the availability flags its projection needs. */
export interface SessionQuestionTarget {
  readonly sessionId: string
  readonly sessionLive: boolean
  readonly sessionPersisted: boolean
  readonly targetIsLiveRoot: boolean
}

/** The log-derived facts one Session contributes before any answerability projection. */
export interface SessionQuestionFacts {
  readonly pending: readonly PendingUserQuestion[]
  readonly waits: readonly QuestionWaitRecord[]
}

/**
 * Facts retained per non-live Session between scans. A Session that is not live
 * cannot open or answer a question, so its projection facts stay valid until it
 * becomes live again — which a scan notices from the fresh availability flags
 * and never serves from here.
 */
export interface SessionQuestionFactsCache {
  read(target: SessionQuestionTarget, now: number): SessionQuestionFacts | undefined
  store(target: SessionQuestionTarget, facts: SessionQuestionFacts, now: number): void
  readonly size: number
}

/** One Session's contribution to a scan, plus how it was produced. */
export interface SessionQuestionRead {
  readonly target: SessionQuestionTarget
  readonly facts: SessionQuestionFacts | undefined
  readonly projectionUnavailable: boolean
  readonly reused: boolean
}

export interface SessionQuestionScanResult {
  readonly reads: readonly SessionQuestionRead[]
  readonly scanned: number
  readonly reused: number
  readonly projectionUnavailable: number
}

/** Bounded fan-out: a worker reserves its slot before awaiting, so no more than `concurrency` loads run at once. */
const mapWithBoundedConcurrency = async <Item, Value>(input: {
  readonly items: readonly Item[]
  readonly concurrency: number
  readonly project: (item: Item) => Promise<Value>
}): Promise<Value[]> => {
  const results = new Array<Value>(input.items.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < input.items.length) {
      // oxlint-disable-next-line antislop/no-passthrough-variable -- Reserve the work slot before awaiting; other workers advance nextIndex.
      const index = nextIndex
      nextIndex += 1
      const item = input.items[index]
      if (item === undefined) continue
      results[index] = await input.project(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(input.concurrency, input.items.length) }, () => worker()))
  return results
}

export class QuestionScan {
  static createFactsCache = (input: { readonly capacity: number; readonly ttlMs: number }): SessionQuestionFactsCache => {
    const entries = new Map<string, { readonly facts: SessionQuestionFacts; readonly storedAt: number }>()
    return {
      read(target, now) {
        if (target.sessionLive) return undefined
        const entry = entries.get(target.sessionId)
        if (entry === undefined) return undefined
        if (now - entry.storedAt > input.ttlMs) {
          entries.delete(target.sessionId)
          return undefined
        }
        entries.delete(target.sessionId)
        entries.set(target.sessionId, entry)
        return entry.facts
      },

      store(target, facts, now) {
        if (target.sessionLive) return
        entries.delete(target.sessionId)
        entries.set(target.sessionId, { facts, storedAt: now })
        while (entries.size > input.capacity) {
          const oldest = entries.keys().next().value
          if (oldest === undefined) break
          entries.delete(oldest)
        }
      },

      get size() {
        return entries.size
      },
    }
  }

  /**
   * Read the question facts of every target Session with bounded concurrency,
   * reusing cached facts for Sessions the caller reported as not live. The loader
   * answers `projectionUnavailable` for a Session it could not read; those reads
   * are never cached, so the next scan tries again.
   */
  static scan = async (input: {
    readonly targets: readonly SessionQuestionTarget[]
    readonly concurrency: number
    readonly cache?: SessionQuestionFactsCache
    readonly now: number
    readonly load: (target: SessionQuestionTarget) => Promise<{ readonly facts?: SessionQuestionFacts; readonly projectionUnavailable: boolean }>
  }): Promise<SessionQuestionScanResult> => {
    const reads = await mapWithBoundedConcurrency({
      items: input.targets,
      concurrency: input.concurrency,
      project: async (target): Promise<SessionQuestionRead> => {
        const cached = input.cache?.read(target, input.now)
        if (cached !== undefined) return { target, facts: cached, projectionUnavailable: false, reused: true }
        const loaded = await input.load(target)
        if (loaded.facts === undefined) return { target, facts: undefined, projectionUnavailable: loaded.projectionUnavailable, reused: false }
        input.cache?.store(target, loaded.facts, input.now)
        return { target, facts: loaded.facts, projectionUnavailable: loaded.projectionUnavailable, reused: false }
      },
    })
    return {
      reads,
      scanned: reads.length,
      reused: reads.filter(read => read.reused).length,
      projectionUnavailable: reads.filter(read => read.projectionUnavailable).length,
    }
  }
}
