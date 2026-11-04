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

  /** The newest checkpoint of `turn`; a fork may record a turn number again after it was rewound. */
  static indexOf(record: UndoHistoryRecord, turn: number | undefined): number {
    if (turn === undefined) return record.checkpoints.length - 1
    for (let index = record.checkpoints.length - 1; index >= 0; index -= 1) if (record.checkpoints[index]?.turn === turn) return index
    return -1
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

  /**
   * The fork an undo or rewind creates keeps every checkpoint before the rewound turn, so it can be rewound again, and
   * remembers how to redo.
   */
  static forked(input: {
    readonly source: UndoHistoryRecord
    readonly forkId: string
    readonly undone: Checkpoint
    /** Position of `undone` in `source.checkpoints`. */
    readonly index: number
    readonly previous: string | null
  }): UndoHistoryRecord {
    const undone = input.undone
    return {
      sessionId: input.forkId,
      checkpoints: input.source.checkpoints.slice(0, input.index),
      redo: { sessionId: input.source.sessionId, provider: undone.provider, cwd: undone.cwd, snapshot: input.previous },
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
