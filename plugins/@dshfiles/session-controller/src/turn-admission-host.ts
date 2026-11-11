import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { pluginStorage } from '@dshfiles/dshx/host'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { ControllerUnavailable, SessionControllerHostRuntime, sessionControllerHostApi, trySessionControllerOperation } from './effect-runtime.ts'
import { DEFAULT_TURN_ADMISSION_POLICY, turnAdmissionPolicySchema, type TurnAdmissionPolicy } from './turn-admission.ts'
import { turnAdmissionApi } from './turn-admission-api.ts'

const STORAGE_NAMESPACE = '@dshfiles/session-controller'
const POLICY_KEY = 'turn-admission/policy'

const controllerOf = (sessionController: Context['sessionController'] | undefined) => {
  if (sessionController === undefined) {
    throw new ControllerUnavailable({ message: 'The Session controller is not running.', code: 'controller-unavailable' })
  }
  return sessionController.turnAdmission
}

/**
 * Apply the stored running-thread limit once the controller runs. An unreadable or missing record keeps the default
 * (no limit), so a broken store never holds a turn.
 */
export const loadTurnAdmissionPolicy = async (ctx: Context): Promise<void> => {
  const stored = await pluginStorage(ctx, STORAGE_NAMESPACE)
    .get(POLICY_KEY)
    .catch(() => undefined)
  const policy = Schema.decodeUnknownOption(turnAdmissionPolicySchema)(stored?.value)
  const queue = ctx.get('sessionController')?.turnAdmission
  queue?.configure(policy._tag === 'Some' ? policy.value : DEFAULT_TURN_ADMISSION_POLICY)
}

export const turnAdmissionHost = sessionControllerHostApi(turnAdmissionApi, {
  snapshot: Effect.fn('turn admission snapshot')(() =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('read turn admission', async () => controllerOf(runtime.sessionController).snapshot()),
    ),
  ),
  configure: Effect.fn('turn admission configure')(({ input }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('configure turn admission', async () => {
        const queue = controllerOf(runtime.sessionController)
        const policy: TurnAdmissionPolicy = { maxRunningThreads: input.maxRunningThreads, countSubagents: input.countSubagents }
        await pluginStorage(runtime.ctx, STORAGE_NAMESPACE).set(POLICY_KEY, policy)
        queue.configure(policy)
        return queue.snapshot()
      }),
    ),
  ),
  forceStart: Effect.fn('turn admission force start')(({ input }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('force-start a waiting turn', async () => {
        if (!runtime.ctx.remoteAccess.allows({ kind: 'session', id: SessionId(input.sessionId) })) return { started: 0 }
        return { started: controllerOf(runtime.sessionController).forceStart(input.sessionId) }
      }),
    ),
  ),
})
