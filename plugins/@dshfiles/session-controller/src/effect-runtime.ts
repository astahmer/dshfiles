import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { PluginApiError } from '@dshfiles/dshx/api'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Schema } from 'effect'

export class ThreadNotFound extends Schema.TaggedError<ThreadNotFound>()('ThreadNotFound', {
  message: Schema.String,
  code: Schema.Literal('thread-not-found'),
}) {}
export class ControllerUnavailable extends Schema.TaggedError<ControllerUnavailable>()('ControllerUnavailable', {
  message: Schema.String,
  code: Schema.Literal('controller-unavailable'),
}) {}
export class ThreadUnavailable extends Schema.TaggedError<ThreadUnavailable>()('ThreadUnavailable', {
  message: Schema.String,
  code: Schema.Literal('thread-unavailable'),
}) {}
export class CommandUnavailable extends Schema.TaggedError<CommandUnavailable>()('CommandUnavailable', {
  message: Schema.String,
  code: Schema.Literal('command-unavailable'),
}) {}
export class AgentPresetsUnavailable extends Schema.TaggedError<AgentPresetsUnavailable>()('AgentPresetsUnavailable', {
  message: Schema.String,
  code: Schema.Literal('agent-presets-unavailable'),
}) {}
export class ThreadModelForbidden extends Schema.TaggedError<ThreadModelForbidden>()('ThreadModelForbidden', {
  message: Schema.String,
  code: Schema.Literal('thread-model-forbidden'),
}) {}
export class ThreadModelSessionRequired extends Schema.TaggedError<ThreadModelSessionRequired>()('ThreadModelSessionRequired', {
  message: Schema.String,
  code: Schema.Literal('thread-model-session-required'),
}) {}
export class SessionControllerOperationFailure extends Schema.TaggedError<SessionControllerOperationFailure>()('SessionControllerOperationFailure', {
  operation: Schema.String,
  message: Schema.String,
}) {}

const taggedFailure = Schema.Struct({ _tag: Schema.String, message: Schema.optional(Schema.String) })

export const trySessionControllerOperation = <Value>(operation: string, run: () => Promise<Value>) =>
  Effect.tryPromise({
    try: run,
    catch: error => {
      if (error instanceof PluginApiError || Schema.is(taggedFailure)(error)) return error
      return new SessionControllerOperationFailure({ operation, message: error instanceof Error ? error.message : String(error) })
    },
  })

const servicesOf = (ctx: CordisContext) => ({
  ctx,
  sessionController: ctx.get('sessionController'),
  commands: ctx.get('commands'),
  workspaceRegistry: ctx.get('workspaceRegistry'),
  sessionQuery: ctx.get('sessionQuery'),
  agentPresets: ctx.get('agentPresets'),
})

export class SessionControllerHostRuntime extends Context.Service<SessionControllerHostRuntime, ReturnType<typeof servicesOf>>()(
  '@dshfiles/session-controller/HostRuntime',
) {}

export const sessionControllerRootLayer = (ctx: CordisContext) => Layer.succeed(SessionControllerHostRuntime, servicesOf(ctx))

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: sessionControllerRootLayer,
  setup: Effect.fn('session controller setup')(() => Effect.void),
})

export { effectPlugin as sessionControllerEffectPlugin, hostApi as sessionControllerHostApi }
