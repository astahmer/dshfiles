import { Effect, Schema } from 'effect'

export class EmbedderLoadFailed extends Schema.TaggedError<EmbedderLoadFailed>()('EmbedderLoadFailed', {
  specifier: Schema.String,
  reason: Schema.Literals(['import-failed', 'no-factory', 'factory-failed', 'bad-shape']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason === 'no-factory') return `${this.specifier} has no default export createEmbedder()`
    if (this.reason === 'bad-shape') return `${this.specifier}'s createEmbedder() did not return { model, embed }`
    return `${this.specifier} could not be loaded`
  }
}

export class EmbeddingFailed extends Schema.TaggedError<EmbeddingFailed>()('EmbeddingFailed', {
  model: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The ${this.model} embedder failed`
  }
}

/** One loaded provider: its model name and the Effect form of its `embed`. */
export type LoadedEmbedder = {
  readonly model: string
  readonly embed: (texts: readonly string[], kind: 'query' | 'document') => Effect.Effect<readonly Float32Array[], EmbeddingFailed>
}

const providerModule = Schema.decodeUnknownEffect(Schema.Struct({ default: Schema.instanceOf(Function) }))
const embedderShape = Schema.decodeUnknownEffect(Schema.Struct({ model: Schema.String.check(Schema.isMinLength(1)), embed: Schema.instanceOf(Function) }))
const vectorList = (expected: number) =>
  Schema.decodeUnknownEffect(Schema.Array(Schema.instanceOf(Float32Array)).check(Schema.isMinLength(expected), Schema.isMaxLength(expected)))

/**
 * The user's embedding module is third-party Promise code: this edge imports it, builds its embedder and decodes every
 * answer, so the rest of memory only sees Effects and typed failures.
 */
export const loadEmbeddingProvider = Effect.fn('memory load embedding provider')(function* (specifier: string) {
  const loaded: unknown = yield* Effect.tryPromise({
    try: () => import(specifier),
    catch: cause => new EmbedderLoadFailed({ specifier, reason: 'import-failed', cause }),
  })
  const module = yield* providerModule(loaded).pipe(Effect.mapError(cause => new EmbedderLoadFailed({ specifier, reason: 'no-factory', cause })))
  const created: unknown = yield* Effect.tryPromise({
    try: async () => module.default(),
    catch: cause => new EmbedderLoadFailed({ specifier, reason: 'factory-failed', cause }),
  })
  const shape = yield* embedderShape(created).pipe(Effect.mapError(cause => new EmbedderLoadFailed({ specifier, reason: 'bad-shape', cause })))
  const model = shape.model
  const embed = shape.embed
  const result: LoadedEmbedder = {
    model,
    embed: (texts, kind) =>
      Effect.tryPromise({
        try: async (): Promise<unknown> => embed(texts, kind),
        catch: cause => new EmbeddingFailed({ model, cause }),
      }).pipe(
        Effect.flatMap(vectorList(texts.length)),
        Effect.mapError(error => (error._tag === 'EmbeddingFailed' ? error : new EmbeddingFailed({ model, cause: error }))),
      ),
  }
  return result
})
