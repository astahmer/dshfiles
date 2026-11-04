import { Settings } from '@dshfiles/dshx/effect/settings'
import { Cache, Context, Duration, Effect, Exit, Fiber, FiberMap, Layer, Semaphore } from 'effect'

import { loadEmbeddingProvider, type LoadedEmbedder } from './embedder-promise.ts'
import { MemoryRepo } from './memory-repo.ts'
import { memorySettings, type MemorySettings } from './settings.ts'

export type RetrievalStatus = {
  readonly requested: 'bm25' | 'hybrid'
  readonly active: 'bm25' | 'hybrid'
  readonly model: string | null
  /** Why hybrid was requested but BM25 serves, when it does. */
  readonly reason: string | null
}

export const MemorySettingsTag = Settings.Tag<MemorySettings>(memorySettings.namespace)

/**
 * The configured embedding provider (`retrieval: 'hybrid'`), loaded once per specifier; a provider that failed to load
 * is retried on the next search instead of staying broken until restart. Memory ships no model: `embeddingProvider`
 * names an ES module whose default export `createEmbedder()` returns `{ model, embed(texts, kind) }`.
 */
export class Embedder extends Context.Service<
  Embedder,
  {
    /** Which ranker serves now: hybrid only when it was asked for and the embedding provider loads. */
    readonly retrieval: Effect.Effect<{ readonly embedder: LoadedEmbedder | undefined; readonly status: RetrievalStatus }>
    /** The query embedded by the active model, or undefined when BM25 serves or the embedder fails. */
    readonly queryVector: (query: string) => Effect.Effect<{ readonly model: string; readonly vector: Float32Array } | undefined>
    /** Embeds a bounded batch of digests and notes with no vector for the active model; concurrent calls share one pass. */
    readonly embedMissing: Effect.Effect<number>
    /** Starts `embedMissing` in the background unless a pass already runs. */
    readonly embedMissingInBackground: Effect.Effect<void>
  }
>()('@dshfiles/memory/Embedder') {
  static readonly layer = Layer.effect(
    Embedder,
    Effect.gen(function* () {
      const settings = yield* MemorySettingsTag
      const repo = yield* MemoryRepo
      const providers = yield* Cache.makeWith(loadEmbeddingProvider, {
        capacity: 8,
        timeToLive: exit => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
      })

      const retrieval = Effect.gen(function* () {
        const current = yield* settings.get
        const specifier = current.embeddingProvider.trim()
        if (current.retrieval === 'bm25') return { embedder: undefined, status: { requested: 'bm25', active: 'bm25', model: null, reason: null } as const }
        if (specifier === '')
          return { embedder: undefined, status: { requested: 'hybrid', active: 'bm25', model: null, reason: 'no embeddingProvider is configured' } as const }
        const loaded = yield* Effect.result(Cache.get(providers, specifier))
        if (loaded._tag === 'Failure')
          return { embedder: undefined, status: { requested: 'hybrid', active: 'bm25', model: null, reason: loaded.failure.message } as const }
        return { embedder: loaded.success, status: { requested: 'hybrid', active: 'hybrid', model: loaded.success.model, reason: null } as const }
      })

      const embedPass = Effect.gen(function* () {
        const { embedder } = yield* retrieval
        if (embedder === undefined) return 0
        const documents = yield* repo.missingEmbeddings({ model: embedder.model, limit: 64 })
        for (let index = 0; index < documents.length; index += 16) {
          const batch = documents.slice(index, index + 16)
          const vectors = yield* embedder.embed(
            batch.map(document => document.text),
            'document',
          )
          yield* Effect.forEach(
            batch,
            (document, row) => {
              const vector = vectors[row]
              return vector === undefined
                ? Effect.void
                : repo.putEmbedding({ kind: document.kind, ref: document.ref, project: document.project, model: embedder.model, vector })
            },
            { discard: true },
          )
        }
        return documents.length
      }).pipe(
        Effect.catchCause(cause => Effect.logWarning('memory: embedding memory failed, BM25 still serves', cause).pipe(Effect.as(0))),
        Effect.withSpan('memory embed missing'),
      )

      const pass = yield* FiberMap.make<'embed', number, never>()
      const lock = yield* Semaphore.make(1)
      const running = lock.withPermits(1)(
        Effect.flatMap(FiberMap.get(pass, 'embed'), existing =>
          existing._tag === 'Some' ? Effect.succeed(existing.value) : FiberMap.run(pass, 'embed', embedPass),
        ),
      )

      return Embedder.of({
        retrieval,
        queryVector: query =>
          Effect.gen(function* () {
            const { embedder } = yield* retrieval
            if (embedder === undefined) return undefined
            const vectors = yield* Effect.option(embedder.embed([query], 'query'))
            const vector = vectors._tag === 'Some' ? vectors.value[0] : undefined
            return vector === undefined ? undefined : { model: embedder.model, vector }
          }),
        embedMissing: Effect.flatMap(running, Fiber.join),
        embedMissingInBackground: Effect.asVoid(running),
      })
    }),
  )
}
