import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { definePlugin, defineTool, generate } from '@dshfiles/dshx/host'
import { Context, Effect, Layer, Schema } from 'effect'
import { pullsReviewApi, type ReviewResult, type SummarizeResult } from './api.js'
import { createJjRun } from './jj.js'
import { renderScopeReport } from './report.js'
import { ReviewWorkspaceModel, type ReviewWorkspaceInput } from './review.js'
import { PullsReviewSummaryModel, type SummarizeWorkspaceInput } from './summarize.js'

type ReviewInput = Omit<ReviewWorkspaceInput, 'run'>
type SummaryInput = Omit<SummarizeWorkspaceInput, 'run' | 'routes' | 'complete'>
type SummarySources = Pick<SummarizeWorkspaceInput, 'routes' | 'complete'>

class PullsReviewOperationError extends Schema.TaggedError<PullsReviewOperationError>()('PullsReviewOperationError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

class PullsReviewOperations extends Context.Service<
  PullsReviewOperations,
  {
    readonly review: (input: ReviewInput) => Effect.Effect<ReviewResult, PullsReviewOperationError>
    readonly summarize: (input: SummaryInput) => Effect.Effect<SummarizeResult, PullsReviewOperationError>
  }
>()('@dshfiles/pulls-review/Operations') {}

const modelCall = async (
  ctx: CordisContext,
  request: {
    readonly provider: string
    readonly model: string
    readonly sessionId?: string | undefined
    readonly system: string
    readonly input: string
    readonly signal: AbortSignal
  },
): Promise<string> =>
  (
    await generate(ctx, {
      model: { provider: request.provider, model: request.model },
      system: request.system,
      prompt: request.input,
      maxTokens: 1_024,
      signal: request.signal,
      // Providers keyed per session (OpenCode Go) reject the call without the thread's session id.
      ...(request.sessionId === undefined ? undefined : { sessionId: request.sessionId }),
    })
  ).text

const operationsLayer = (ctx: CordisContext) => {
  const run = createJjRun(ctx)
  const sessionQuery = ctx.get('sessionQuery')
  const llm = ctx.get('llm')
  const routes: SummarySources['routes'] = {
    providerOf: async sessionId => {
      const log = await sessionQuery?.readSession(SessionId(sessionId)).catch(() => undefined)
      const header = log?.events.findLast(event => event.type === 'request/header')
      return header?.type === 'request/header' ? header.data.header.config.provider : undefined
    },
    modelsOf: async provider => ((await llm?.listModels(provider).catch(() => [])) ?? []).map(model => model.id),
  }
  const complete: SummarySources['complete'] = request => modelCall(ctx, request)
  const review = (input: ReviewInput): Effect.Effect<ReviewResult, PullsReviewOperationError> =>
    Effect.tryPromise({
      try: () => ReviewWorkspaceModel.review({ ...input, run }),
      catch: () => new PullsReviewOperationError({ operation: 'review', message: 'Jujutsu could not read this workspace.' }),
    })
  const summarize = (input: SummaryInput): Effect.Effect<SummarizeResult, PullsReviewOperationError> =>
    Effect.tryPromise({
      try: async () => {
        if (llm === undefined)
          return { status: 'failed', reason: 'llm-unavailable', message: 'The Host has no language-model service to summarize with.' } satisfies SummarizeResult
        try {
          return await PullsReviewSummaryModel.summarize({ ...input, run, routes, complete })
        } catch {
          return { status: 'failed', reason: 'llm-failed', message: 'The model call failed; the thread model may be unavailable.' } satisfies SummarizeResult
        }
      },
      catch: () => new PullsReviewOperationError({ operation: 'summarize', message: 'The model call failed; the thread model may be unavailable.' }),
    })
  return Layer.succeed(PullsReviewOperations, { review, summarize })
}

const effectPlugin = DshxEffect.plugin({
  layer: operationsLayer,
  setup: () => Effect.void,
})

export default definePlugin({
  id: 'dshfiles-pulls-review',
  uses: ['rpc', 'commands', 'tools'],
  inject: ['subprocess'],
  setup: async api => {
    const ctx = api.raw.ctx
    const run = createJjRun(ctx)
    const disposeEffect = await effectPlugin.setup(ctx, {})
    const registration = api.rpc.register(
      effectPlugin.hostApi(pullsReviewApi, {
        review: Effect.fn('pulls-review review')(function* (request) {
          const operations = yield* PullsReviewOperations
          return yield* operations.review({
            path: request.input.path,
            base: request.input.base,
            fromChangeId: request.input.fromChangeId,
            toChangeId: request.input.toChangeId,
            signal: request.signal,
          })
        }),
        summarize: Effect.fn('pulls-review summarize')(function* (request) {
          const operations = yield* PullsReviewOperations
          return yield* operations.summarize({ ...request.input, signal: request.signal })
        }),
      }),
    )
    void registration.catch((error: unknown) =>
      ctx.logger.warn('pulls-review: API registration failed: %s', error instanceof Error ? error.message : String(error)),
    )

    api.commands.register({
      name: 'pulls',
      description: "Review this thread's changes, grouped like a pull request",
      handler: async invocation => {
        const cwd = invocation.agent.session.header.cwd
        if (cwd === undefined || cwd.length === 0) return { kind: 'error', text: 'This thread has no workspace folder to review.' }
        const result = await ReviewWorkspaceModel.review({ run, path: cwd, signal: invocation.signal })
        if (result.status === 'failed') return { kind: 'error', text: result.message }
        if (result.fileCount === 0) return { kind: 'success', text: `pulls.review · ${result.range} — no changes yet.` }
        return { kind: 'success', text: renderScopeReport(result) }
      },
    })

    api.tools.register(
      defineTool({
        name: 'pulls_review',
        description:
          "Read a workspace's changes against a base bookmark, or an exact saved range of persistent JJ change IDs, and return pulls.review scopes with per-scope file and line counts.",
        parameters: {
          path: { type: 'string', required: true, description: 'Absolute path of the workspace to review.' },
          base: { type: 'string', description: 'Base bookmark or revision; defaults to the first of main, master or trunk.' },
          fromChangeId: {
            type: 'string',
            description: 'Persistent JJ change ID for the saved range base; requires toChangeId and path set to the owning repository root.',
          },
          toChangeId: {
            type: 'string',
            description: 'Persistent JJ change ID for the saved range head; requires fromChangeId and path set to the owning repository root.',
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(input: { readonly path: string; readonly base?: string; readonly fromChangeId?: string; readonly toChangeId?: string }, execution) {
          execution.signal.throwIfAborted()
          const result = await ReviewWorkspaceModel.review({
            run,
            path: input.path,
            base: input.base,
            fromChangeId: input.fromChangeId,
            toChangeId: input.toChangeId,
            signal: execution.signal,
          })
          if (result.status === 'failed') throw new Error(result.message)
          if (result.fileCount === 0) return `pulls.review · ${result.range} — no changes yet.`
          return renderScopeReport(result)
        },
      }),
    )
    return disposeEffect
  },
})
