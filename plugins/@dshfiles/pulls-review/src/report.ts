import type { ReviewResult } from './api.js'

type OkReview = Extract<ReviewResult, { readonly status: 'ok' }>

const MAX_FILE_LINES = 20

const fileLine = (path: string, additions: number, deletions: number): string => `  - ${path} (+${additions} −${deletions})`

const counts = (additions: number, deletions: number): string => `+${additions} −${deletions}`

/** The text `/pulls` prints in the thread and `pulls_review` returns to an agent. */
export const renderScopeReport = (review: OkReview): string => {
  const stats = new Map(review.files.map(file => [file.path, file]))
  const lines = [
    `pulls.review · ${review.range} · ${review.fileCount} file${review.fileCount === 1 ? '' : 's'} · ${counts(review.additions, review.deletions)}`,
  ]
  if (review.truncated) lines.push('The diff was too large for one read and is truncated.')
  for (const scope of review.scopes) {
    lines.push(`${scope.label} (${scope.filePaths.length}) · ${counts(scope.additions, scope.deletions)} · ${scope.summary}`)
    for (const path of scope.filePaths.slice(0, MAX_FILE_LINES)) {
      const file = stats.get(path)
      lines.push(fileLine(path, file?.additions ?? 0, file?.deletions ?? 0))
    }
    if (scope.filePaths.length > MAX_FILE_LINES) lines.push(`  … ${scope.filePaths.length - MAX_FILE_LINES} more`)
  }
  return lines.join('\n')
}
