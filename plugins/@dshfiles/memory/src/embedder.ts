import * as Schema from 'effect/Schema'

/**
 * A local embedding model memory can rank with (`retrieval: 'hybrid'`). Memory ships none: point the
 * `embeddingProvider` setting at an ES module whose default export is `createEmbedder()` returning this shape
 * (an example wrapping transformers.js is in the README).
 */
export type MemoryEmbedder = {
  /** Stored with every vector; changing it re-embeds everything under the new name. */
  readonly model: string
  /** One unit-length vector per text, in order. `query` and `document` may use different prompts. */
  readonly embed: (texts: readonly string[], kind: 'query' | 'document') => Promise<readonly Float32Array[]>
}

export type RetrievalStatus = {
  readonly requested: 'bm25' | 'hybrid'
  readonly active: 'bm25' | 'hybrid'
  readonly model: string | null
  /** Why hybrid was requested but BM25 serves, when it does. */
  readonly reason: string | null
}

const embedderSchema = Schema.Struct({ model: Schema.String.check(Schema.isMinLength(1)), embed: Schema.instanceOf(Function) })
const providerModuleSchema = Schema.Struct({ default: Schema.instanceOf(Function) })

const vectorListSchema = (expected: number) => Schema.Array(Schema.instanceOf(Float32Array)).check(Schema.isMinLength(expected), Schema.isMaxLength(expected))

export class EmbeddingProviders {
  /** Loads the provider module and builds its embedder; rejects with a readable reason. */
  static async load(specifier: string): Promise<MemoryEmbedder> {
    const module = Schema.decodeUnknownResult(providerModuleSchema)(await import(specifier))
    if (module._tag === 'Failure') throw new Error(`${specifier} has no default export createEmbedder()`)
    const created: unknown = await module.success.default()
    const parsed = Schema.decodeUnknownResult(embedderSchema)(created)
    if (parsed._tag === 'Failure') throw new Error(`${specifier}'s createEmbedder() did not return { model, embed }`)
    const embed = parsed.success.embed
    return {
      model: parsed.success.model,
      embed: async (texts, kind) => Schema.decodeUnknownSync(vectorListSchema(texts.length))(await embed(texts, kind)),
    }
  }
}
