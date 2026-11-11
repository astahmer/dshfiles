import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { threadModelApi } from '@dshfiles/session-controller/thread-model-api'
import { Effect, Layer } from 'effect'
import type { ScheduledSend, SendModel } from './scheduled-send-api.js'
import { ScheduledSendDelivery, type DeliveryOutcome } from './scheduled-sends.js'

interface CallFailure {
  readonly message: string
  readonly kind: string
  readonly retryable: boolean
  readonly remoteCode?: string | undefined
}

const sameModel = (current: SendModel, wanted: SendModel): boolean =>
  current.provider === wanted.provider &&
  current.model === wanted.model &&
  (wanted.reasoningEffort === undefined || current.reasoningEffort === wanted.reasoningEffort)

const failure = (error: CallFailure, step: string): DeliveryOutcome => {
  if (error.kind === 'unavailable')
    return {
      kind: 'failed',
      retryable: true,
      note: `Not sent yet: the session controller plugin (@dshfiles/session-controller) is not loaded, so the message cannot reach the thread. Add it to this DSH profile and restart DSH; the message is tried again.`,
    }
  const retryable = error.retryable || error.kind === 'transport'
  return {
    kind: 'failed',
    retryable,
    note: retryable
      ? `Not sent yet (${step}): ${error.message} It is tried again in 30 seconds.`
      : `Not sent (${step}): ${error.message} Edit the message to send it again, or cancel it.`,
  }
}

/** Delivery through the session controller: the thread-model switch first when the send names a model, then the prompt. */
export const ScheduledSendDeliveryLive = Layer.effect(
  ScheduledSendDelivery,
  Effect.gen(function* () {
    const apis = yield* HostApis
    const sessions = apis.client(sessionsApi)
    const threadModel = apis.client(threadModelApi)

    const switchModel = (send: ScheduledSend, wanted: SendModel): Effect.Effect<DeliveryOutcome | undefined> =>
      Effect.gen(function* () {
        const snapshot = yield* threadModel.snapshot({ sessionId: send.sessionId })
        if (sameModel(snapshot.selection, wanted)) return undefined
        yield* threadModel.select({
          sessionId: send.sessionId,
          selection: wanted,
          expectedRevision: snapshot.revision,
          preferSelectedProvider: snapshot.preferSelectedProvider,
        })
        return undefined
      }).pipe(
        Effect.catch(error =>
          Effect.succeed<DeliveryOutcome>(
            error.remoteCode === 'thread-model-busy' || error.remoteCode === 'thread-model-stale'
              ? { kind: 'wait', note: 'Waiting for the thread’s queued messages to be sent before switching its model.' }
              : failure(error, `switching to ${wanted.model}`),
          ),
        ),
      )

    const deliver = (send: ScheduledSend): Effect.Effect<DeliveryOutcome> =>
      Effect.gen(function* () {
        if (send.model !== undefined) {
          const blocked = yield* switchModel(send, send.model)
          if (blocked !== undefined) return blocked
        }
        return yield* sessions.prompt({ sessionId: send.sessionId, text: send.text, mode: 'queue', requestId: send.requestId }).pipe(
          Effect.as<DeliveryOutcome>({ kind: 'sent' }),
          Effect.catch(error => Effect.succeed(failure(error, 'sending'))),
        )
      })

    return ScheduledSendDelivery.of({ deliver })
  }),
)
