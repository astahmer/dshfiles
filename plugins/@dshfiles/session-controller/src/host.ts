import { defineHost } from '@dshfiles/dshx/host'
import { Effect, Schema } from 'effect'
import SessionController from './native/index.ts'
import { sessionControllerEffectPlugin } from './effect-runtime.ts'
import { continuationHost } from './continuation-host.ts'
import { interruptionHost } from './interruption-host.ts'
import { threadModelHost } from './thread-model-host.ts'
import { loadSessionInstructions, sessionInstructionsSection, sessionsHost } from './sessions-host.ts'

const defaultConfig = { listWorkSliceMs: 16 }
const configSchema = Schema.Struct({
  nativeOpen: Schema.optional(Schema.Boolean),
  listWorkSliceMs: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(Schema.withDecodingDefaultKey(Effect.succeed(16))),
}).pipe(Schema.withDecodingDefault(Effect.succeed(defaultConfig)))
const configStandardSchema = { '~standard': Schema.toStandardSchemaV1(configSchema)['~standard'] }

export default defineHost({
  ...sessionControllerEffectPlugin,
  name: '@dshfiles/session-controller',
  Config: configStandardSchema,
  inject: [...SessionController.inject, 'remoteAccess'],
  apis: [interruptionHost, continuationHost, threadModelHost, sessionsHost],
  prompts: [sessionInstructionsSection],
  setup: async (ctx, config: unknown) => {
    // Wait for the forked native controller to finish activating: the root layer below reads `sessionController`
    // once, and an unfinished activation left every sessions call answering `controller-unavailable` on a slow start.
    await ctx.plugin(SessionController, SessionController.Config(Schema.decodeUnknownSync(configSchema)(config)))
    loadSessionInstructions(ctx)
    return sessionControllerEffectPlugin.setup(ctx, config)
  },
})
