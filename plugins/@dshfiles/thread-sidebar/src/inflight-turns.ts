import { join } from 'node:path'
import { z } from 'zod'
import { dshHome } from './dsh-home.js'
import { JsonFile } from './json-file.js'
import { JsonText } from './json-text.js'
import type { RecoveryReason } from './restart-recovery.js'

const sessionIdSchema = z.string().min(1).max(256)
const MAX_INFLIGHT_TURNS = 5000

/** One turn this Host process opened and has not seen close. */
const inflightTurnSchema = z.object({ sessionId: sessionIdSchema, startedAt: z.number().int().nonnegative() }).strict()

const persistedInflightSchema = z.object({ version: z.literal(1), entries: z.array(inflightTurnSchema).max(MAX_INFLIGHT_TURNS) }).strict()

export type InflightTurn = z.infer<typeof inflightTurnSchema>

export interface InflightTurnStore {
  list(): Promise<InflightTurn[]>
  start(sessionId: string): Promise<void>
  /** Remove one turn and report whether this Host still had it open. */
  end(sessionId: string): Promise<boolean>
  /** Read the turns still in flight and clear the file, so one exit is promoted once. */
  take(): Promise<InflightTurn[]>
}

const turnStartSchema = z.object({ type: z.literal('turn/start') })

const turnEndSchema = z.object({
  type: z.literal('turn/end'),
  data: z.object({ reason: z.object({ kind: z.string().max(64) }).optional() }).optional(),
})

/** A turn opens here, closes here, or closes here because another process ended it first. */
export type TurnBoundary = 'start' | 'end' | 'interrupted'

/** The recovery rows an in-flight promotion writes, kept structural so this module owns no store. */
interface RecoveryRecorder {
  record(sessionIds: readonly string[], reason: RecoveryReason): Promise<void>
}

/**
 * Classify one Session event as a turn boundary, ignoring every other event. An
 * `interrupted` ending is kept apart: crash recovery writes that reason for a turn
 * another process left open, so it still needs a resume row when its marker closes.
 */
const parseTurnBoundary = (event: unknown): TurnBoundary | null => {
  if (turnStartSchema.safeParse(event).success) return 'start'
  const end = turnEndSchema.safeParse(event)
  if (!end.success) return null
  return end.data.data?.reason?.kind === 'interrupted' ? 'interrupted' : 'end'
}

/**
 * The turns this Host process has open, durable enough to survive the process
 * itself: `turn/start` records one and `turn/end` removes it, so whatever the
 * next process finds here was interrupted by this one stopping.
 */
export class InflightTurns {
  static readonly filePath = (home?: string): string => join(dshHome(home), 'runtime', 'thread-sidebar-inflight-turns.json')

  static readonly boundaryFromEvent = parseTurnBoundary

  static readonly open = (options: { readonly home?: string; readonly now?: () => number } = {}): InflightTurnStore => {
    const path = InflightTurns.filePath(options.home)
    const now = options.now ?? Date.now
    const transact = JsonFile.transaction()

    const read = async (): Promise<InflightTurn[]> => {
      const contents = await JsonFile.readText({ path, missing: '{"version":1,"entries":[]}' })
      const parsed = JsonText.decode(persistedInflightSchema, contents)
      if (parsed === undefined || !parsed.success) throw new Error('In-flight turn state is invalid.')
      return parsed.data.entries
    }

    const write = (entries: readonly InflightTurn[]): Promise<void> => JsonFile.write({ path, text: `${JSON.stringify({ version: 1, entries })}\n` })

    return {
      list: (): Promise<InflightTurn[]> => transact(read),
      start: (sessionId: string): Promise<void> =>
        transact(async () => {
          if (sessionId.length === 0 || sessionId.length > 256) return
          const entries = await read()
          if (entries.some(entry => entry.sessionId === sessionId)) return
          await write([...entries, { sessionId, startedAt: now() }].slice(-MAX_INFLIGHT_TURNS))
        }),
      end: (sessionId: string): Promise<boolean> =>
        transact(async () => {
          const entries = await read()
          const next = entries.filter(entry => entry.sessionId !== sessionId)
          if (next.length === entries.length) return false
          await write(next)
          return true
        }),
      take: (): Promise<InflightTurn[]> =>
        transact(async () => {
          const entries = await read()
          if (entries.length > 0) await write([])
          return entries
        }),
    }
  }

  /**
   * Promote every turn a previous Host process left open into the recovery
   * store, so a crash shows up in the thread list exactly like a managed
   * restart does. `take` clears the file before the promotion is recorded: a
   * failed record must not repeat the same rows on the next boot.
   */
  static readonly promote = async (options: {
    readonly inflight: Pick<InflightTurnStore, 'take'>
    readonly recovery: RecoveryRecorder
  }): Promise<readonly string[]> => {
    const entries = await options.inflight.take()
    if (entries.length === 0) return []
    const sessionIds = entries.map(entry => entry.sessionId)
    await options.recovery.record(sessionIds, 'interrupted')
    return sessionIds
  }
}
