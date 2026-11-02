import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { SessionId } from '@dshfiles/dshx/ids'
import { Jj } from '@dshfiles/jj-cli'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer, Option, Schema } from 'effect'
import { pullsReviewApi } from './api.js'
import { ReviewJj } from './jj.js'
import { reviewReportText } from './report.js'
import { ReviewWorkspace } from './review.js'
import { PullsReviewSummary } from './summarize.js'
import { SummaryRoutes } from './summary-routes-promise.js'

const decodeSessionId = Schema.decodeUnknownOption(SessionId)

/** `/pulls`: the thread workspace's review report, printed in the thread. */
const pullsCommand = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* hostService('commands')
    const report = yield* DshxPlugin.callback((cwd: string | undefined): Effect.Effect<CommandResult, never, ReviewWorkspace> =>
      cwd === undefined || cwd.length === 0
        ? Effect.succeed({ kind: 'error', text: 'This thread has no workspace folder to review.' })
        : ReviewWorkspace.use(workspace => workspace.review({ path: cwd })).pipe(
            Effect.map((result): CommandResult => ({ kind: result.status === 'failed' ? 'error' : 'success', text: reviewReportText(result) })),
            Effect.catchTag('PullsReviewOperationError', error => Effect.succeed<CommandResult>({ kind: 'error', text: error.message })),
          ),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        commands.register({
          name: 'pulls',
          description: "Review this thread's changes, grouped like a pull request",
          handler: invocation => report(invocation.agent.session.header.cwd),
        }),
      ),
      unregister => Effect.sync(unregister),
    )
  }),
)

const jjLayer = ReviewJj.layer.pipe(Layer.provide(Jj.layer), Layer.provide(Layer.mergeAll(DshChildProcessSpawner.layer, NodeFileSystem.layer, NodePath.layer)))

const reviewLayer = Layer.provideMerge(ReviewWorkspace.layer, Layer.merge(jjLayer, NodeFileSystem.layer))

const pullsReviewLayer = Layer.provideMerge(pullsCommand, Layer.provideMerge(PullsReviewSummary.layer, Layer.merge(reviewLayer, SummaryRoutes.layer)))

export default DshxPlugin.make({
  name: 'dshfiles-pulls-review',
  inject: ['subprocess', 'commands'],
  layer: pullsReviewLayer,
  apis: [
    Api.bind(pullsReviewApi, {
      review: input => ReviewWorkspace.use(workspace => workspace.review(input)),
      report: input => ReviewWorkspace.use(workspace => workspace.review(input)).pipe(Effect.map(result => ({ text: reviewReportText(result) }))),
      summarize: input =>
        PullsReviewSummary.use(summary =>
          summary.summarize({
            path: input.path,
            base: input.base,
            sessionId: input.sessionId === undefined ? undefined : Option.getOrUndefined(decodeSessionId(input.sessionId)),
            provider: input.provider,
            model: input.model,
          }),
        ),
    }),
  ],
})
