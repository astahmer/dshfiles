import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { PluginApiError } from '@dshfiles/dshx/api'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { z } from 'zod'
import { sessionUndoApi } from './api.js'
import { UndoHistory } from './undo-history.js'
import { createUndoService, type UndoService } from './undo-service.js'

const PACKAGE_ID = '@dshfiles/session-undo'

/** One history store per Host process: API handlers receive other Cordis contexts, and a second store would clobber rows. */
let opening: Promise<UndoService> | undefined

const serviceFor = (ctx: Context): Promise<UndoService> => {
  if (opening === undefined) {
    const started = startService(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  return opening
}

const modelSelectionSchema = z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().optional() })
const projectedSelectionSchema = z.object({ next: modelSelectionSchema.nullable(), lastUsed: modelSelectionSchema.nullable() })

/** Only a message the user wrote names a turn; DSH also appends runtime-context and time messages as user turns. */
const userWritten = z.object({ source: z.object({ kind: z.literal('user') }) })

const api = sessionUndoApi.host({
  history: async ({ ctx, input }) => (await serviceFor(ctx)).history(input.sessionId),
  undo: async ({ ctx, input }) => (await serviceFor(ctx)).undo(input.sessionId),
  redo: async ({ ctx, input }) => (await serviceFor(ctx)).redo(input.sessionId),
})

/** Turns started and not yet ended, from Session events; a Host restart ends every turn, so an empty set is right. */
const running = new Set<string>()

const startService = async (ctx: Context): Promise<UndoService> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined)
    throw new PluginApiError('DSH storage is unavailable, so undo history cannot be kept; restart DSH and retry.', { code: 'storage-missing' })
  const domain = await storage.open(UndoHistory.domain)
  const controller = () => {
    const found = ctx.get('sessionController')
    if (found === undefined) throw new PluginApiError('The Session controller is unavailable; restart DSH and retry.', { code: 'controller-missing' })
    return found
  }
  const registry = () => {
    const found = ctx.get('workspaceRegistry')
    if (found === undefined) throw new PluginApiError('The workspace registry is unavailable; restart DSH and retry.', { code: 'registry-missing' })
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
        const selection = projectedSelectionSchema.safeParse(values?.modelSelection)
        const chosen = selection.success ? (selection.data.next ?? selection.data.lastUsed) : null
        if (chosen === null) return
        const route = { sessionId: SessionId(input.to), provider: chosen.provider, model: chosen.model }
        await controller().selectModel(chosen.reasoningEffort === undefined ? route : { ...route, reasoningEffort: chosen.reasoningEffort })
      },
      archive: sessionId => registry().archiveSession(SessionId(sessionId)),
      unarchive: sessionId => registry().unarchiveSession(SessionId(sessionId)),
    },
  })
}

export default defineHost({
  name: PACKAGE_ID,
  inject: ['storageDomain', 'tools'],
  apis: [api],
  setup: (ctx: Context) => {
    const lastSeq = new Map<string, number>()
    const turns = new Map<string, number>()
    const withService = (use: (service: UndoService) => Promise<void>): void => {
      void serviceFor(ctx)
        .then(use)
        .catch(error => ctx.logger.warn('session-undo: %s', error instanceof Error ? error.message : String(error)))
    }
    withService(async () => undefined)
    ctx.on('session/event', (session, event) => {
      const sessionId = String(session.header.id)
      if (event.type === 'turn/end') running.delete(sessionId)
      if (event.type === 'turn/start') {
        running.add(sessionId)
        turns.set(sessionId, event.data.turn)
        const forkAtSeq = lastSeq.get(sessionId) ?? event.seq - 1
        const cwd = session.header.cwd
        if (cwd !== undefined) withService(service => service.turnStarted({ sessionId, turn: event.data.turn, forkAtSeq, cwd }))
      }
      if (event.type === 'user/message' && userWritten.safeParse(event.data).success) {
        const turn = turns.get(sessionId)
        const text = UndoHistory.promptOf(event.data.content)
        if (turn !== undefined && text !== '') withService(service => service.promptEntered({ sessionId, turn, text }))
      }
      lastSeq.set(sessionId, event.seq)
    })
    // A turn's snapshot must finish before its first tool call can change a file.
    ctx.on('tools/pre-execute', async (execution, next) => {
      const agentId = execution.agent?.id
      if (agentId !== undefined)
        await serviceFor(ctx).then(
          service => service.whenReady(String(agentId)),
          () => undefined,
        )
      return next()
    })
  },
})
