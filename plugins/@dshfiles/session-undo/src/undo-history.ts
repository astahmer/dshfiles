import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Schema } from 'effect'

const nonEmptyString = Schema.String.check(Schema.isMinLength(1))
const nonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const snapshotRef = Schema.NullOr(Schema.String.check(Schema.isMaxLength(512)))

const checkpointSchema = Schema.Struct({
  turn: nonNegativeInt,
  /** The last event before the turn started: the conversation an undo forks back to. */
  forkAtSeq: nonNegativeInt,
  cwd: nonEmptyString,
  /** Owner of the VCS provider that took the snapshot; null when no provider claims the folder. */
  provider: Schema.NullOr(Schema.String),
  snapshot: snapshotRef,
  prompt: Schema.String.check(Schema.isMaxLength(200)),
  at: nonNegativeInt,
})

const redoSchema = Schema.Struct({
  /** The thread the undo forked from, archived until a redo brings it back. */
  sessionId: nonEmptyString,
  provider: Schema.NullOr(Schema.String),
  cwd: nonEmptyString,
  /** The files as they were before the undo restored the checkpoint. */
  snapshot: snapshotRef,
})

const historySchema = Schema.Struct({
  sessionId: nonEmptyString,
  checkpoints: Schema.Array(checkpointSchema).check(Schema.isMaxLength(20)),
  redo: Schema.NullOr(redoSchema),
})

export type Checkpoint = typeof checkpointSchema.Type
export type UndoHistoryRecord = typeof historySchema.Type

const MAX_CHECKPOINTS = 20

/** Per-thread turn checkpoints (conversation cut + file snapshot) and the redo an undo left behind. */
export class UndoHistory {
  static readonly checkpointSchema = checkpointSchema

  static readonly domain = defineDomain({
    name: 'dshfiles_session_undo',
    version: 1,
    layout: 'per-record',
    tables: { history: { valueSchema: zodSchemaFromEffect(historySchema), __key: 'history' } },
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
