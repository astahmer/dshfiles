import type { PendingUserQuestion } from '@deepseek-ai/dsh-user-questions'
import { Context, Effect, Layer, Option, RcMap, Schema } from 'effect'
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

/** What one Session read answers, before the scan decides how to reuse it. */
export interface SessionQuestionLoad {
  readonly facts?: SessionQuestionFacts
  readonly projectionUnavailable: boolean
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

/** Where a scan reads one Session's question facts from: its live projection on the Host. */
export class QuestionFacts extends Context.Service<QuestionFacts, { readonly load: (target: SessionQuestionTarget) => Effect.Effect<SessionQuestionLoad> }>()(
  '@dshfiles/agent-questions/QuestionFacts',
) {}

const targetKeySchema = Schema.fromJsonString(
  Schema.Struct({ sessionId: Schema.String, sessionLive: Schema.Boolean, sessionPersisted: Schema.Boolean, targetIsLiveRoot: Schema.Boolean }),
)
const encodeTargetKey = Schema.encodeSync(targetKeySchema)
const decodeTargetKey = Schema.decodeEffect(targetKeySchema)

/**
 * Facts retained per non-live Session between scans. A Session that is not live cannot open or answer a question, so
 * its projection facts stay valid until it becomes live again — which a scan notices from the fresh availability
 * flags and never serves from here. Least recently read entries leave first.
 */
const makeFactsCache = (input: { readonly capacity: number; readonly ttlMs: number }) => {
  const entries = new Map<string, { readonly facts: SessionQuestionFacts; readonly storedAt: number }>()
  return {
    read: (target: SessionQuestionTarget, now: number): Option.Option<SessionQuestionFacts> => {
      if (target.sessionLive) return Option.none()
      const entry = entries.get(target.sessionId)
      if (entry === undefined) return Option.none()
      entries.delete(target.sessionId)
      if (now - entry.storedAt > input.ttlMs) return Option.none()
      entries.set(target.sessionId, entry)
      return Option.some(entry.facts)
    },
    store: (target: SessionQuestionTarget, facts: SessionQuestionFacts, now: number): void => {
      if (target.sessionLive) return
      entries.delete(target.sessionId)
      entries.set(target.sessionId, { facts, storedAt: now })
      for (const oldest of entries.keys()) {
        if (entries.size <= input.capacity) break
        entries.delete(oldest)
      }
    },
  }
}

export interface QuestionScanOptions {
  /** One root call projects every Session, and a cold projection re-reads a session log: bound the parallel reads. */
  readonly concurrency: number
  readonly cacheCapacity: number
  /** A stopped Session cannot open or answer a question, so its facts stay valid far longer than one poll. */
  readonly cacheTtlMs: number
}

const make = Effect.fnUntraced(function* (options: QuestionScanOptions) {
  const source = yield* QuestionFacts
  const cache = makeFactsCache({ capacity: options.cacheCapacity, ttlMs: options.cacheTtlMs })
  // One in-flight read per Session availability scope, shared by concurrent scans and dropped as soon as nobody holds
  // it; the read is interrupted only when its last caller leaves.
  const reads = yield* RcMap.make({ lookup: (key: string) => Effect.flatMap(Effect.orDie(decodeTargetKey(key)), source.load) })

  const readTarget = (target: SessionQuestionTarget, now: number): Effect.Effect<SessionQuestionRead> => {
    const cached = cache.read(target, now)
    if (Option.isSome(cached)) return Effect.succeed({ target, facts: cached.value, projectionUnavailable: false, reused: true })
    return Effect.scoped(RcMap.get(reads, encodeTargetKey(target))).pipe(
      Effect.map(loaded => {
        if (loaded.facts !== undefined) cache.store(target, loaded.facts, now)
        return { target, facts: loaded.facts, projectionUnavailable: loaded.projectionUnavailable, reused: false }
      }),
    )
  }

  /**
   * Read the question facts of every target Session with bounded concurrency, reusing cached facts for Sessions
   * reported as not live. A Session whose projection could not be read is never cached, so the next scan retries it.
   */
  const scan = Effect.fn('question scan')(function* (input: { readonly targets: ReadonlyArray<SessionQuestionTarget>; readonly now: number }) {
    yield* Effect.annotateCurrentSpan({ 'dshx.agent_questions.targets': input.targets.length })
    const sessionReads = yield* Effect.forEach(input.targets, target => readTarget(target, input.now), { concurrency: options.concurrency })
    const result: SessionQuestionScanResult = {
      reads: sessionReads,
      scanned: sessionReads.length,
      reused: sessionReads.filter(read => read.reused).length,
      projectionUnavailable: sessionReads.filter(read => read.projectionUnavailable).length,
    }
    return result
  })

  return QuestionScan.of({ scan })
})

/** Scans of the native question facts of many Sessions, cached for stopped Sessions and shared while in flight. */
export class QuestionScan extends Context.Service<
  QuestionScan,
  {
    readonly scan: (input: { readonly targets: ReadonlyArray<SessionQuestionTarget>; readonly now: number }) => Effect.Effect<SessionQuestionScanResult>
  }
>()('@dshfiles/agent-questions/QuestionScan') {
  static readonly layerWith = (options: QuestionScanOptions) => Layer.effect(QuestionScan, make(options))
  static readonly layer = QuestionScan.layerWith({ concurrency: 8, cacheCapacity: 4_096, cacheTtlMs: 600_000 })
}
