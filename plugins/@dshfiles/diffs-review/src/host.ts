import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { HostCommands } from '@dshfiles/dshx/effect/host-commands'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { SessionId } from '@dshfiles/dshx/ids'
import { Git } from '@dshfiles/git-cli'
import { Jj } from '@dshfiles/jj-cli'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Effect, Layer, Option, Schema } from 'effect'
import { diffsReviewApi } from './api.js'
import { ReviewGit } from './git.js'
import { ReviewJj } from './jj.js'
import { ProjectBase } from './project-base.js'
import { reviewReportText } from './report.js'
import { ReviewWorkspace } from './review.js'
import { RevisionReviewModel } from './revision-review.js'
import { DiffsReviewSummary } from './summarize.js'
import { SummaryRoutes } from './summary-routes-promise.js'

const decodeSessionId = Schema.decodeUnknownOption(SessionId)

/** The thread workspace's review report, printed in the thread. */
const reportCommand = (name: string, description: string) =>
  HostCommands.register({
    name,
    description,
    handler: invocation => {
      const cwd = invocation.agent.session.header.cwd
      if (cwd === undefined || cwd.length === 0) return Effect.succeed<CommandResult>({ kind: 'error', text: 'This thread has no workspace folder to review.' })
      return ReviewWorkspace.use(workspace => workspace.review({ path: cwd })).pipe(
        Effect.map((result): CommandResult => ({ kind: result.status === 'failed' ? 'error' : 'success', text: reviewReportText(result) })),
        Effect.catchTag('DiffsReviewOperationError', error => Effect.succeed<CommandResult>({ kind: 'error', text: error.message })),
      )
    },
  })

/** `/diffs`, and `/pulls`, the name it had while this plugin was pulls-review, so habits and saved prompts keep working. */
const reportCommands = Layer.mergeAll(
  Layer.effectDiscard(reportCommand('diffs', "Review this thread's changes, grouped by review scope")),
  Layer.effectDiscard(reportCommand('pulls', 'Former name of /diffs')),
)

const platformLayer = Layer.mergeAll(DshChildProcessSpawner.layer, NodeFileSystem.layer, NodePath.layer)
const jjLayer = ReviewJj.layer.pipe(Layer.provide(Jj.layer), Layer.provide(platformLayer))
/** The git adapter: a thread workspace in a git-only repository reviews through git instead of jj. */
const gitLayer = ReviewGit.layer.pipe(Layer.provide(Git.layer), Layer.provide(platformLayer))

const reviewLayer = Layer.provideMerge(
  ReviewWorkspace.layer,
  Layer.mergeAll(jjLayer, gitLayer, NodeFileSystem.layer, ProjectBase.layer.pipe(Layer.provide(HostApis.layer))),
)

const diffsReviewLayer = Layer.provideMerge(reportCommands, Layer.provideMerge(DiffsReviewSummary.layer, Layer.merge(reviewLayer, SummaryRoutes.layer)))

export default DshxPlugin.make({
  name: 'dshfiles-diffs-review',
  inject: ['subprocess', 'commands'],
  layer: diffsReviewLayer,
  apis: [
    Api.bind(diffsReviewApi, {
      review: input => ReviewWorkspace.use(workspace => workspace.review(input)),
      report: input => ReviewWorkspace.use(workspace => workspace.review(input)).pipe(Effect.map(result => ({ text: reviewReportText(result) }))),
      reviewRevisions: input => ReviewWorkspace.use(workspace => workspace.reviewRevisions(input)),
      reportRevisions: input =>
        ReviewWorkspace.use(workspace => workspace.reviewRevisions(input)).pipe(Effect.map(result => ({ text: RevisionReviewModel.reportText(result) }))),
      summarize: input =>
        DiffsReviewSummary.use(summary =>
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
