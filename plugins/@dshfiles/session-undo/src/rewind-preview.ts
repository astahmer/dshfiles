import type { Checkpoint } from '@dshfiles/plugin-ui/components/motion/checkpoint-graph'

/** One recorded turn as `history` returns it. */
export interface HistoryCheckpoint {
  readonly turn: number
  readonly prompt: string
  /** When the checkpoint was taken, in epoch milliseconds. */
  readonly at: number
  readonly files: boolean
}

export interface RewindPreviewLabels {
  /** Label of a checkpoint whose prompt is empty. */
  readonly untitled: string
  /** Note on a checkpoint that has a file snapshot. */
  readonly files: string
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** Elapsed time since the first checkpoint: `m:ss` under an hour, `HhMM` beyond, so it fits the graph's time column. */
export const elapsedLabel = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${String(hours)}h${pad(minutes)}`
  return `${String(minutes)}:${pad(seconds % 60)}`
}

/**
 * The rewind confirmation's graph: every recorded turn on one lane, the turns from `fromIndex` on marked abandoned
 * (they leave the conversation), each timed relative to the first checkpoint.
 */
export const rewindPreview = (checkpoints: readonly HistoryCheckpoint[], fromIndex: number, labels: RewindPreviewLabels): readonly Checkpoint[] => {
  const start = checkpoints[0]?.at ?? 0
  return checkpoints.map((checkpoint, index) => {
    const row: Checkpoint = {
      id: `${String(checkpoint.turn)}-${String(checkpoint.at)}`,
      label: checkpoint.prompt === '' ? labels.untitled : checkpoint.prompt,
      lane: 0,
      abandoned: fromIndex >= 0 && index >= fromIndex,
      time: elapsedLabel(checkpoint.at - start),
    }
    return checkpoint.files ? { ...row, note: labels.files } : row
  })
}
