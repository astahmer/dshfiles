import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { definePlugin, defineTool, generate } from '@dshfiles/dshx/host'
import { pullsReviewApi, type SummarizeResult } from './api.js'
import { createJjRun } from './jj.js'
import { renderScopeReport } from './report.js'
import { ReviewWorkspaceModel } from './review.js'
import { PullsReviewSummaryModel } from './summarize.js'

/** The thread's own provider, as its last request recorded it. */
const providerOf = async (ctx: Context, sessionId: string): Promise<string | undefined> => {
  const log = await ctx
    .get('sessionQuery')
    ?.readSession(SessionId(sessionId))
    .catch(() => undefined)
  const header = log?.events.findLast(event => event.type === 'request/header')
  return header?.type === 'request/header' ? header.data.header.config.provider : undefined
}

const modelCall = async (
  ctx: Context,
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

export default definePlugin({
  id: 'dshfiles-pulls-review',
  uses: ['rpc', 'commands', 'tools'],
  inject: ['subprocess'],
  setup(api) {
    const ctx = api.raw.ctx
    const run = createJjRun(ctx)

    const registration = api.rpc.register(
      pullsReviewApi.host({
        review: ({ input, signal }) =>
          ReviewWorkspaceModel.review({
            run,
            path: input.path,
            base: input.base,
            fromChangeId: input.fromChangeId,
            toChangeId: input.toChangeId,
            signal,
          }),
        summarize: async ({ input, signal }): Promise<SummarizeResult> => {
          const llm = ctx.get('llm')
          if (llm === undefined) return { status: 'failed', reason: 'llm-unavailable', message: 'The Host has no language-model service to summarize with.' }
          try {
            return await PullsReviewSummaryModel.summarize({
              run,
              path: input.path,
              base: input.base,
              sessionId: input.sessionId,
              provider: input.provider,
              model: input.model,
              signal,
              routes: {
                providerOf: sessionId => providerOf(ctx, sessionId),
                modelsOf: async provider => (await llm.listModels(provider).catch(() => [])).map(model => model.id),
              },
              complete: request => modelCall(ctx, request),
            })
          } catch {
            return { status: 'failed', reason: 'llm-failed', message: 'The model call failed; the thread model may be unavailable.' }
          }
        },
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
          fromChangeId: { type: 'string', description: 'Persistent JJ change ID for the saved range base; requires toChangeId and path set to the owning repository root.' },
          toChangeId: { type: 'string', description: 'Persistent JJ change ID for the saved range head; requires fromChangeId and path set to the owning repository root.' },
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
  },
})
