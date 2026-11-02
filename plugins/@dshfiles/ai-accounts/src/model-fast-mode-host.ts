import type { Context } from '@deepseek-ai/cordis'
import { SessionScopeRefused } from './errors.js'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api } from '@dshfiles/dshx/effect'
import { accountRuntime } from './account-runtime.js'
import { effectHandler } from './host-effect.js'
import { aiAccountsFastModeApi } from './model-fast-mode-api.js'

type FastModeRouteInput = {
  readonly sessionId?: string | undefined
  readonly provider: string
  readonly model: string
}

type FastModeRoute = Omit<FastModeRouteInput, 'sessionId'> & { readonly sessionId: string }

export const fastModeRouteForCaller = (input: FastModeRouteInput, caller: ApiCaller): FastModeRoute => {
  if (caller.kind === 'agent') {
    if (caller.sessionId === undefined) throw new SessionScopeRefused({ reason: 'fast-mode-agent-session' })
    if (input.sessionId !== undefined && input.sessionId !== caller.sessionId) {
      throw new SessionScopeRefused({ reason: 'fast-mode-other-session' })
    }
    return { ...input, sessionId: caller.sessionId }
  }

  if (input.sessionId === undefined) throw new SessionScopeRefused({ reason: 'fast-mode-session' })
  return { ...input, sessionId: input.sessionId }
}

const fastModeFor = (ctx: Context) => {
  const fastMode = accountRuntime(ctx)?.fastMode
  if (fastMode === undefined) throw new Error('AI Accounts Fast mode is unavailable.')
  return fastMode
}

export const modelFastModeHostApi = Api.bind(aiAccountsFastModeApi, {
  status: effectHandler(aiAccountsFastModeApi, 'status', ({ ctx, input, caller }) => fastModeFor(ctx).status(fastModeRouteForCaller(input, caller))),
  setFast: effectHandler(aiAccountsFastModeApi, 'setFast', ({ ctx, input, caller }) =>
    fastModeFor(ctx).set({ ...fastModeRouteForCaller(input, caller), enabled: input.enabled }),
  ),
})
