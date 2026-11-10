import { randomUUID } from 'node:crypto'
import { PluginStorage } from '@dshfiles/dshx/effect/plugin-storage'
import { Context, Effect, Layer, Option, Schema, Semaphore } from 'effect'
import { artifactSchema } from './artifacts-api.js'

type Artifact = typeof artifactSchema.Type
const storedSchema = Schema.Struct({ version: Schema.Literal(1), artifact: artifactSchema })
const decode = Schema.decodeUnknownEffect(storedSchema)
const encode = Schema.encodeSync(Schema.toCodecJson(storedSchema))
const prefix = (sessionId: string) => `artifacts/v1/${encodeURIComponent(sessionId)}/`
const key = (sessionId: string, id: string) => `${prefix(sessionId)}${encodeURIComponent(id)}`

export class ArtifactNotFound extends Schema.TaggedError<ArtifactNotFound>()(
  'ArtifactNotFound',
  { id: Schema.String },
  { dshxWireCode: 'artifact-not-found' },
) {
  override get message() {
    return `Artifact ${this.id} not found in this thread.`
  }
}

const make = Effect.gen(function* () {
  const storage = yield* PluginStorage
  const lock = yield* Semaphore.make(1)
  const read = Effect.fn('artifact read')(function* (sessionId: string, id: string) {
    const entry = yield* storage.get(key(sessionId, id))
    if (Option.isNone(entry)) return yield* new ArtifactNotFound({ id })
    return (yield* decode(entry.value.value)).artifact
  })
  const put = (sessionId: string, artifact: Artifact) => storage.set(key(sessionId, artifact.id), encode({ version: 1, artifact }))
  return {
    list: Effect.fn('artifact list')(function* (sessionId: string) {
      const entries = yield* storage.listAll({ prefix: prefix(sessionId) })
      const artifacts: Array<Omit<Artifact, 'content'>> = []
      for (const entry of entries) {
        const artifact = (yield* decode(entry.value)).artifact
        artifacts.push({
          id: artifact.id,
          title: artifact.title,
          mimeType: artifact.mimeType,
          revision: artifact.revision,
          createdAt: artifact.createdAt,
          updatedAt: artifact.updatedAt,
        })
      }
      return { artifacts }
    }),
    read: (sessionId: string, id: string) => read(sessionId, id).pipe(Effect.map(artifact => ({ artifact }))),
    create: (sessionId: string, input: { readonly title: string; readonly mimeType: Artifact['mimeType']; readonly content: string }) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const now = new Date().toISOString()
          const artifact: Artifact = {
            id: randomUUID(),
            title: input.title,
            mimeType: input.mimeType,
            content: input.content,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          }
          yield* put(sessionId, artifact)
          return { artifact }
        }),
      ),
    update: (
      sessionId: string,
      input: {
        readonly id: string
        readonly expectedRevision: number
        readonly title?: string | undefined
        readonly mimeType?: Artifact['mimeType'] | undefined
        readonly content?: string | undefined
      },
    ) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* read(sessionId, input.id)
          if (current.revision !== input.expectedRevision) return { status: 'conflict' as const, currentRevision: current.revision }
          const artifact: Artifact = {
            id: current.id,
            title: input.title ?? current.title,
            mimeType: input.mimeType ?? current.mimeType,
            content: input.content ?? current.content,
            revision: current.revision + 1,
            createdAt: current.createdAt,
            updatedAt: new Date().toISOString(),
          }
          yield* put(sessionId, artifact)
          return { artifact }
        }),
      ),
    delete: (sessionId: string, input: { readonly id: string; readonly expectedRevision: number }) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* read(sessionId, input.id)
          if (current.revision !== input.expectedRevision) return { status: 'conflict' as const, currentRevision: current.revision }
          yield* storage.delete(key(sessionId, input.id))
          return { deleted: true as const }
        }),
      ),
  }
})

export class ArtifactStore extends Context.Service<ArtifactStore, Effect.Success<typeof make>>()('@dshfiles/editor/ArtifactStore') {
  static readonly layer = Layer.effect(ArtifactStore, make).pipe(Layer.provide(PluginStorage.layerFor('@dshfiles/editor-artifacts')))
}
