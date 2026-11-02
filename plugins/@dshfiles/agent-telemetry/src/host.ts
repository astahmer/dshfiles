import type {} from '@deepseek-ai/dsh-session'
import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Effect, Layer, Ref, Stream } from 'effect'
import { createCoordinator } from './coordinator.js'
import { createCallPricer } from './cost.js'
import { GenAi } from './genai.js'
import { flushTraces, PricingCatalog } from './pricing-promise.js'
import { agentTelemetrySettings, type AgentTelemetrySettings } from './settings.js'

const TelemetrySettings = Settings.Tag<AgentTelemetrySettings>(agentTelemetrySettings.namespace)

/**
 * The span coordinator is a synchronous hot-path interceptor on `llm/stream`, `tools/execute` and Session events:
 * a fiber per model chunk would cost more than the spans it records, so it stays imperative and this layer only owns
 * its lifetime and the live settings and prices it reads.
 */
const SpanCoordinator = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const pricing = yield* PricingCatalog
    const settings = yield* TelemetrySettings
    const captureMode = yield* Ref.make((yield* settings.get).captureContent)
    yield* settings.changes.pipe(
      Stream.runForEach(value => Ref.set(captureMode, value.captureContent)),
      Effect.forkScoped,
    )
    const logger = host.ctx.logger('agent-telemetry')

    const coordinator = createCoordinator({
      captureContent: () => {
        const mode = Ref.getUnsafe(captureMode)
        return mode === 'environment' ? GenAi.contentCaptureFromEnvironment(process.env) : mode === 'on'
      },
      priceCall: createCallPricer({ catalog: pricing.current, accountKind: pricing.accountKind }),
      warn: message => logger.warn(message),
    })
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        for (const session of host.ctx.sessions.list()) coordinator.adopt(session)
      }),
      () =>
        Effect.andThen(
          Effect.sync(() => coordinator.closeAll()),
          flushTraces,
        ),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() => [
        host.ctx.on('session/created', session => coordinator.onCreated(session)),
        host.ctx.on('session/event', (session, event) => coordinator.onEvent(session, event)),
        host.ctx.on('session/disposed', session => coordinator.onDisposed(session)),
        host.ctx.on('tools/execute', (exec, next) => coordinator.runTool(exec, next)),
        host.ctx.on('llm/stream', (options, next) => coordinator.interceptLlm(options, next)),
      ]),
      disposers =>
        Effect.sync(() => {
          for (const dispose of disposers.reverse()) dispose()
        }),
    )
  }),
)

export default DshxPlugin.make({
  name: 'agent-telemetry',
  inject: ['sessions'],
  settings: [agentTelemetrySettings],
  layer: SpanCoordinator.pipe(Layer.provide(PricingCatalog.layer), Layer.provide(Layer.merge(HostApis.layer, Settings.layer(agentTelemetrySettings)))),
})
