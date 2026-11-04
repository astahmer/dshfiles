import { NodeServices } from '@effect/platform-node'
import { Effect, FileSystem, Layer, Path, Tracer } from 'effect'
import { Jj } from './jj.ts'
import { JjViewReads } from './jj-view-reads.ts'

export const JjTestLayer = Layer.provideMerge(JjViewReads.layer, Layer.provideMerge(Jj.layer, NodeServices.layer))

/** A fresh `jj git init` repository in a scoped temporary directory. */
export const temporaryRepository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const jj = yield* Jj
  const root = yield* fileSystem.realPath(yield* fileSystem.makeTempDirectoryScoped({ prefix: 'jj-cli-' }))
  const repository = path.join(root, 'repo')
  yield* jj.exec({ args: ['git', 'init', repository], cwd: root })
  return { root, repository }
})

/** Records every span the wrapped effect starts, the way the Host tracer would receive them. */
export const recordSpans = () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span: options => {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  return {
    spans,
    named: (name: string) => spans.filter(span => span.name === name),
    trace: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.withTracer(effect, tracer),
  }
}
