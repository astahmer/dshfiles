import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const checkpointSchema = z
  .object({
    turn: z.number().int().nonnegative(),
    /** The last event before the turn started: the conversation an undo forks back to. */
    forkAtSeq: z.number().int().nonnegative(),
    cwd: z.string().min(1),
    /** Owner of the VCS provider that took the snapshot; null when no provider claims the folder. */
    provider: z.string().nullable(),
    snapshot: z.string().max(512).nullable(),
    prompt: z.string().max(200),
    at: z.number().int().nonnegative(),
  })
  .strict()

const redoSchema = z
  .object({
    /** The thread the undo forked from, archived until a redo brings it back. */
    sessionId: z.string().min(1),
    provider: z.string().nullable(),
    cwd: z.string().min(1),
    /** The files as they were before the undo restored the checkpoint. */
    snapshot: z.string().max(512).nullable(),
  })
  .strict()

const historySchema = z
  .object({
    sessionId: z.string().min(1),
    checkpoints: z.array(checkpointSchema).max(20),
    redo: redoSchema.nullable(),
  })
  .strict()

export type Checkpoint = z.infer<typeof checkpointSchema>
export type UndoHistoryRecord = z.infer<typeof historySchema>

const MAX_CHECKPOINTS = 20

/** Per-thread turn checkpoints (conversation cut + file snapshot) and the redo an undo left behind. */
export class UndoHistory {
  static readonly checkpointSchema = checkpointSchema

  static readonly domain = defineDomain({
    name: 'dshfiles_session_undo',
    version: 1,
    layout: 'per-record',
    tables: { history: { valueSchema: historySchema, __key: 'history' } },
  })

  static empty(sessionId: string): UndoHistoryRecord {
    return { sessionId, checkpoints: [], redo: null }
  }

  /** A new turn is new work: it adds a checkpoint and drops the redo, as an editor does. */
  static withCheckpoint(record: UndoHistoryRecord, checkpoint: Checkpoint): UndoHistoryRecord {
    return { ...record, checkpoints: [...record.checkpoints, checkpoint].slice(-MAX_CHECKPOINTS), redo: null }
  }

  static withPrompt(record: UndoHistoryRecord, turn: number, prompt: string): UndoHistoryRecord {
    return {
      ...record,
      checkpoints: record.checkpoints.map(checkpoint =>
        checkpoint.turn === turn && checkpoint.prompt === '' ? { ...checkpoint, prompt: prompt.slice(0, 200) } : checkpoint,
      ),
    }
  }

  /** The fork an undo creates keeps every earlier checkpoint, so it can be undone again, and remembers how to redo. */
  static forked(input: {
    readonly source: UndoHistoryRecord
    readonly forkId: string
    readonly undone: Checkpoint
    readonly previous: string | null
  }): UndoHistoryRecord {
    return {
      sessionId: input.forkId,
      checkpoints: input.source.checkpoints.slice(0, -1),
      redo: { sessionId: input.source.sessionId, provider: input.undone.provider, cwd: input.undone.cwd, snapshot: input.previous },
    }
  }

  static promptOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
    return content
      .flatMap(block => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 200)
  }
}
