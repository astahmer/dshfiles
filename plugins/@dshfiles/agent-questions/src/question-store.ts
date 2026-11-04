import { StorageDomain, type StorageTable } from '@dshfiles/dshx/effect/storage-domain'
import { Context, Effect, Layer, Stream } from 'effect'
import { parentQuestionDomain, type ParentQuestionRecord, type RevisionedFeedbackRecord } from './store.js'

/** The durable parent-question and Markdown-feedback records, open for the plugin's lifetime. */
export class QuestionStore extends Context.Service<
  QuestionStore,
  {
    readonly questions: StorageTable<string, ParentQuestionRecord>
    readonly feedback: StorageTable<string, RevisionedFeedbackRecord>
    /** Every committed write of the domain, from any writer on the Host. */
    readonly changes: Stream.Stream<void>
  }
>()('@dshfiles/agent-questions/QuestionStore') {
  static readonly layer = Layer.effect(
    QuestionStore,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const domain = yield* storage.open(parentQuestionDomain)
      return QuestionStore.of({
        questions: domain.table('questions'),
        feedback: domain.table('feedback'),
        changes: Stream.map(domain.changes, () => undefined),
      })
    }),
  )
}
