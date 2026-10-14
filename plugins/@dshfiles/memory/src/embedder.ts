import { z } from 'zod'

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

const embedderSchema = z.object({ model: z.string().min(1), embed: z.instanceof(Function) })
const providerModuleSchema = z.object({ default: z.instanceof(Function) })

export class EmbeddingProviders {
  /** Loads the provider module and builds its embedder; rejects with a readable reason. */
  static async load(specifier: string): Promise<MemoryEmbedder> {
    const module = providerModuleSchema.safeParse(await import(specifier))
    if (!module.success) throw new Error(`${specifier} has no default export createEmbedder()`)
    const created: unknown = await module.data.default()
    const parsed = embedderSchema.safeParse(created)
    if (!parsed.success) throw new Error(`${specifier}'s createEmbedder() did not return { model, embed }`)
    const embed = parsed.data.embed
    return {
      model: parsed.data.model,
      embed: async (texts, kind) =>
        z
          .array(z.instanceof(Float32Array))
          .length(texts.length)
          .parse(await embed(texts, kind)),
    }
  }
}
