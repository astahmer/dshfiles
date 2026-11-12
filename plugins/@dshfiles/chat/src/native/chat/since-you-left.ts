/**
 * dshfiles (productivity pass T4.3): the recap above the first Turn the user has not seen. Built from the turn marks
 * (`@dshfiles/chat/turn-marks`, the Host fold of turn-summary's facts), never from a model call. The unseen range comes
 * from the unread record the opening surface handed over (`SinceYouLeftModel.note`) before clearing it.
 */
import type { SinceYouLeftNote } from '../../thread-tools.ts'
import { ThreadFindModel } from './thread-find-model.ts'
import type { TurnRailItem } from './turn-rail-items.ts'

export interface RecapFile {
  readonly path: string
  readonly added: number
  readonly removed: number
  /** The last unseen Turn that wrote it: its chip jumps there. */
  readonly turn: number
}

export interface SinceYouLeftRecap {
  /** The first unseen Turn: the divider goes above it. */
  readonly firstTurn: number
  readonly turns: number
  /** Files written across the unseen Turns, most changed first. */
  readonly files: readonly RecapFile[]
  /** Distinct files written, including any a Turn counted past its listed files. */
  readonly fileCount: number
  readonly added: number
  readonly removed: number
  readonly failedTurns: readonly number[]
  /** Unseen Turns that asked a question. */
  readonly questionTurns: readonly number[]
  /** Questions still waiting for an answer. */
  readonly questionsWaiting: number
}

/** File chips the card shows before "+N more". */
export const RECAP_FILE_CHIPS = 6

export class SinceYouLeftRecapModel {
  /**
   * The recap for a thread opened with unseen Turns, or null when nothing unseen is known.
   * @param items - every known Turn, ascending (outline sequences and marks merged).
   */
  static readonly recap = (items: readonly TurnRailItem[], note: SinceYouLeftNote): SinceYouLeftRecap | null => {
    const seq = note.firstUnreadSeq ?? note.finishedSeq
    const firstTurn = ThreadFindModel.turnOf(items, seq)
    if (firstTurn === null) return null
    const unseen = items.filter(item => item.turn >= firstTurn)
    if (unseen.length === 0) return null
    const files = new Map<string, { added: number; removed: number; turn: number }>()
    let unlisted = 0
    let added = 0
    let removed = 0
    const failedTurns: number[] = []
    const questionTurns: number[] = []
    let questionsWaiting = 0
    for (const item of unseen) {
      const mark = item.mark
      if (item.kind === 'failed') failedTurns.push(item.turn)
      if (mark === undefined) continue
      if (mark.question) questionTurns.push(item.turn)
      if (mark.questionOpen) questionsWaiting += 1
      added += mark.added
      removed += mark.removed
      unlisted += Math.max(0, mark.fileCount - mark.files.length)
      for (const file of mark.files) {
        const previous = files.get(file.path)
        files.set(file.path, { added: (previous?.added ?? 0) + file.added, removed: (previous?.removed ?? 0) + file.removed, turn: item.turn })
      }
    }
    const listed = [...files]
      .map(([path, value]) => ({ path, ...value }))
      .sort((left, right) => right.added + right.removed - (left.added + left.removed) || left.path.localeCompare(right.path))
    return {
      firstTurn,
      turns: unseen.length,
      files: listed,
      fileCount: listed.length + unlisted,
      added,
      removed,
      failedTurns,
      questionTurns,
      questionsWaiting,
    }
  }

  /** The file name a chip shows: the last path segment. */
  static readonly fileName = (path: string): string => path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path
}
