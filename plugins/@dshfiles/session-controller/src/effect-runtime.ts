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

interface SessionControllerHostServices {
  readonly ctx: CordisContext
  readonly sessionController: CordisContext['sessionController'] | undefined
  readonly commands: CordisContext['commands'] | undefined
  readonly workspaceRegistry: CordisContext['workspaceRegistry'] | undefined
  readonly sessionQuery: CordisContext['sessionQuery'] | undefined
  readonly agentPresets: CordisContext['agentPresets'] | undefined
}

export class SessionControllerHostRuntime extends Context.Service<SessionControllerHostRuntime, SessionControllerHostServices>()(
  '@dshfiles/session-controller/HostRuntime',
) {}

/**
 * Each service is read when a handler uses it, not once at setup: the native controller this plugin starts waits for
 * `sessionQuery`, which an owned search backend registers after its worker starts, so a setup-time read could keep
 * `undefined` for the life of the Host.
 */
export const sessionControllerRootLayer = (ctx: CordisContext) =>
  Layer.succeed(SessionControllerHostRuntime, {
    ctx,
    get sessionController() {
      return ctx.get('sessionController')
    },
    get commands() {
      return ctx.get('commands')
    },
    get workspaceRegistry() {
      return ctx.get('workspaceRegistry')
    },
    get sessionQuery() {
      return ctx.get('sessionQuery')
    },
    get agentPresets() {
      return ctx.get('agentPresets')
    },
  })

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: sessionControllerRootLayer,
  setup: Effect.fn('session controller setup')(() => Effect.void),
})

export { effectPlugin as sessionControllerEffectPlugin, hostApi as sessionControllerHostApi }
