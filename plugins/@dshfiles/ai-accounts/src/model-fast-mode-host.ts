import type { Context } from '@deepseek-ai/cordis'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { accountRuntime } from './account-runtime.js'
import { aiAccountsFastModeApi } from './model-fast-mode-api.js'

type FastModeRouteInput = {
  readonly sessionId?: string | undefined
  readonly provider: string
  readonly model: string
}

type FastModeRoute = Omit<FastModeRouteInput, 'sessionId'> & { readonly sessionId: string }

export const fastModeRouteForCaller = (input: FastModeRouteInput, caller: ApiCaller): FastModeRoute => {
  if (caller.kind === 'agent') {
    if (caller.sessionId === undefined) throw new Error('Fast mode requires an active Agent session.')
    if (input.sessionId !== undefined && input.sessionId !== caller.sessionId) {
      throw new Error('Agents can only access Fast mode for their own session.')
    }
    return { ...input, sessionId: caller.sessionId }
  }

  if (input.sessionId === undefined) throw new Error('Fast mode requires a session ID.')
  return { ...input, sessionId: input.sessionId }
}

const fastModeFor = (ctx: Context) => {
  const fastMode = accountRuntime(ctx)?.fastMode
  if (fastMode === undefined) throw new Error('AI Accounts Fast mode is unavailable.')
  return fastMode
}

export const modelFastModeHostApi = aiAccountsFastModeApi.host({
  status: ({ ctx, input, caller }) => fastModeFor(ctx).status(fastModeRouteForCaller(input, caller)),
  setFast: ({ ctx, input, caller }) => fastModeFor(ctx).set({ ...fastModeRouteForCaller(input, caller), enabled: input.enabled }),
})
