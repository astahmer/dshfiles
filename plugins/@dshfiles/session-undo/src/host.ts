import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { Context as EffectContext, Effect, Layer, Option, Schema } from 'effect'
import { sessionUndoApi } from './api.js'
import { UndoHistory } from './undo-history.js'
import { createUndoService, type UndoService } from './undo-service.js'

const PACKAGE_ID = '@dshfiles/session-undo'

class StorageMissing extends Schema.TaggedError<StorageMissing>()('StorageMissing', { message: Schema.String }) {}
class ControllerMissing extends Schema.TaggedError<ControllerMissing>()('ControllerMissing', { message: Schema.String }) {}
class RegistryMissing extends Schema.TaggedError<RegistryMissing>()('RegistryMissing', { message: Schema.String }) {}

class SessionUndoRuntime extends EffectContext.Service<
  SessionUndoRuntime,
  {
    readonly serviceFor: () => Promise<UndoService>
    readonly running: Set<string>
  }
>()('@dshfiles/session-undo/Runtime') {}

const modelSelectionSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoningEffort: Schema.optional(Schema.String),
})
const projectedSelectionSchema = Schema.Struct({ next: Schema.NullOr(modelSelectionSchema), lastUsed: Schema.NullOr(modelSelectionSchema) })

/** Only a message the user wrote names a turn; DSH also appends runtime-context and time messages as user turns. */
const userWritten = Schema.Struct({ source: Schema.Struct({ kind: Schema.Literal('user') }) })

const rootLayer = (ctx: Context) =>
  Layer.effect(
    SessionUndoRuntime,
    Effect.sync(() => {
      let opening: Promise<UndoService> | undefined
      const running = new Set<string>()
      const startService = async (): Promise<UndoService> => {
        const storage = ctx.get('storageDomain')
        if (storage === undefined) throw new StorageMissing({ message: 'DSH storage is unavailable, so undo history cannot be kept; restart DSH and retry.' })
        const domain = await storage.open(UndoHistory.domain)
        const controller = () => {
          const found = ctx.get('sessionController')
          if (found === undefined) throw new ControllerMissing({ message: 'The Session controller is unavailable; restart DSH and retry.' })
          return found
        }
        const registry = () => {
          const found = ctx.get('workspaceRegistry')
          if (found === undefined) throw new RegistryMissing({ message: 'The workspace registry is unavailable; restart DSH and retry.' })
          return found
        }
        return createUndoService({
          table: domain.table('history'),
          now: Date.now,
          files: {
            snapshot: async cwd => {
              const provider = await VcsProviders.resolve(ctx, { path: cwd, callerPackageId: PACKAGE_ID })
              if (provider === undefined) return null
              return { provider: provider.owner, snapshot: (await provider.client.snapshot({ path: cwd })).snapshot }
            },
            restore: async input => {
              const client = createHostApiClient(ctx, VcsProviders.contract(input.provider), PACKAGE_ID)
              return (await client.restore({ path: input.cwd, snapshot: input.snapshot })).previous
            },
          },
          sessions: {
            running: async sessionId => running.has(sessionId),
            fork: async input => String((await controller().fork({ sessionId: SessionId(input.sessionId), atSeq: input.atSeq })).sessionId),
            copyModel: async input => {
              const projected = await controller().projections({ sessionId: SessionId(input.from) }, AbortSignal.timeout(30_000))
              const values = projected?.kind === 'sequenced' ? projected.values : projected?.values
              const selection = Option.getOrNull(Schema.decodeUnknownOption(projectedSelectionSchema)(values?.modelSelection))
              const chosen = selection === null ? null : selection.next ?? selection.lastUsed
              if (chosen === null) return
              const route = { sessionId: SessionId(input.to), provider: chosen.provider, model: chosen.model }
              await controller().selectModel(chosen.reasoningEffort === undefined ? route : { ...route, reasoningEffort: chosen.reasoningEffort })
            },
            archive: sessionId => registry().archiveSession(SessionId(sessionId)),
            unarchive: sessionId => registry().unarchiveSession(SessionId(sessionId)),
          },
        })
      }
      const serviceFor = (): Promise<UndoService> => {
        if (opening === undefined) {
          const started = startService()
          opening = started
          void started.catch(() => {
            if (opening === started) opening = undefined
          })
        }
        return opening
      }
      return { serviceFor, running }
    }),
  )

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: rootLayer,
  setup: ctx =>
    Effect.gen(function* () {
      const runtime = yield* SessionUndoRuntime
      const lastSeq = new Map<string, number>()
      const turns = new Map<string, number>()
      const withService = (use: (service: UndoService) => Promise<void>): void => {
        void runtime
          .serviceFor()
          .then(use)
          .catch(error => ctx.logger.warn('session-undo: %s', error instanceof Error ? error.message : String(error)))
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const stopSessionEvents = ctx.on('session/event', (session, event) => {
            const sessionId = String(session.header.id)
            if (event.type === 'turn/end') runtime.running.delete(sessionId)
            if (event.type === 'turn/start') {
              runtime.running.add(sessionId)
              turns.set(sessionId, event.data.turn)
              const forkAtSeq = lastSeq.get(sessionId) ?? event.seq - 1
              const cwd = session.header.cwd
              if (cwd !== undefined) withService(service => service.turnStarted({ sessionId, turn: event.data.turn, forkAtSeq, cwd }))
            }
            if (event.type === 'user/message' && Option.isSome(Schema.decodeUnknownOption(userWritten)(event.data))) {
              const turn = turns.get(sessionId)
              const text = UndoHistory.promptOf(event.data.content)
              if (turn !== undefined && text !== '') withService(service => service.promptEntered({ sessionId, turn, text }))
            }
            lastSeq.set(sessionId, event.seq)
          })
          // A turn's snapshot must finish before its first tool call can change a file.
          const stopBeforeTool = ctx.on('tools/pre-execute', async (execution, next) => {
            const agentId = execution.agent?.id
            if (agentId !== undefined) {
              await runtime.serviceFor().then(
                service => service.whenReady(String(agentId)),
                () => undefined,
              )
            }
            return next()
          })
          withService(async () => undefined)
          return () => {
            stopBeforeTool()
            stopSessionEvents()
          }
        }),
        stop => Effect.sync(stop),
      )
    }),
})

const api = hostApi(sessionUndoApi, {
  history: Effect.fn('session undo history read')(({ input }) =>
    SessionUndoRuntime.use(runtime =>
      Effect.tryPromise({ try: () => runtime.serviceFor().then(service => service.history(input.sessionId)), catch: error => error }),
    ),
  ),
  undo: Effect.fn('session undo')(({ input }) =>
    SessionUndoRuntime.use(runtime =>
      Effect.tryPromise({ try: () => runtime.serviceFor().then(service => service.undo(input.sessionId)), catch: error => error }),
    ),
  ),
  redo: Effect.fn('session redo')(({ input }) =>
    SessionUndoRuntime.use(runtime =>
      Effect.tryPromise({ try: () => runtime.serviceFor().then(service => service.redo(input.sessionId)), catch: error => error }),
    ),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: PACKAGE_ID,
  inject: ['storageDomain', 'tools'],
  apis: [api],
})
