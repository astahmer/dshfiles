import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { HostCommands } from '@dshfiles/dshx/effect/host-commands'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { SessionId } from '@dshfiles/dshx/ids'
import { Git } from '@dshfiles/git-cli'
import { Jj } from '@dshfiles/jj-cli'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer, Option, Schema } from 'effect'
import { pullsReviewApi } from './api.js'
import { ReviewGit } from './git.js'
import { ReviewJj } from './jj.js'
import { reviewReportText } from './report.js'
import { ReviewWorkspace } from './review.js'
import { PullsReviewSummary } from './summarize.js'
import { SummaryRoutes } from './summary-routes-promise.js'

const decodeSessionId = Schema.decodeUnknownOption(SessionId)

/** `/pulls`: the thread workspace's review report, printed in the thread. */
const pullsCommand = Layer.effectDiscard(
  HostCommands.register({
    name: 'pulls',
    description: "Review this thread's changes, grouped like a pull request",
    handler: invocation => {
      const cwd = invocation.agent.session.header.cwd
      if (cwd === undefined || cwd.length === 0) return Effect.succeed<CommandResult>({ kind: 'error', text: 'This thread has no workspace folder to review.' })
      return ReviewWorkspace.use(workspace => workspace.review({ path: cwd })).pipe(
        Effect.map((result): CommandResult => ({ kind: result.status === 'failed' ? 'error' : 'success', text: reviewReportText(result) })),
        Effect.catchTag('PullsReviewOperationError', error => Effect.succeed<CommandResult>({ kind: 'error', text: error.message })),
      )
    },
  }),
)

const platformLayer = Layer.mergeAll(DshChildProcessSpawner.layer, NodeFileSystem.layer, NodePath.layer)
const jjLayer = ReviewJj.layer.pipe(Layer.provide(Jj.layer), Layer.provide(platformLayer))
/** The git adapter: a thread workspace in a git-only repository reviews through git instead of jj. */
const gitLayer = ReviewGit.layer.pipe(Layer.provide(Git.layer), Layer.provide(platformLayer))

const reviewLayer = Layer.provideMerge(ReviewWorkspace.layer, Layer.mergeAll(jjLayer, gitLayer, NodeFileSystem.layer))

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
