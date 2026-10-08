import type { FileStatus } from './api.js'

export interface PatchRow {
  readonly kind: 'context' | 'addition' | 'deletion'
  readonly oldLine: number | null
  readonly newLine: number | null
  readonly text: string
}

export interface PatchHunk {
  readonly unmodifiedBefore: number
  readonly rows: readonly PatchRow[]
}

export interface PatchFile {
  readonly path: string
  readonly previousPath: string | null
  readonly status: FileStatus
  readonly binary: boolean
  readonly hunks: readonly PatchHunk[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

const stripPrefix = (value: string, prefix: string): string | null => (value.startsWith(prefix) ? value.slice(prefix.length) : null)

/** Recover both paths from `diff --git a/X b/Y`; equal halves resolve names containing spaces. */
const headerPaths = (header: string) => {
  const body = header.slice('diff --git '.length)
  const half = (body.length - 1) / 2
  if (Number.isInteger(half) && body.startsWith('a/') && body.slice(half + 1).startsWith('b/') && body.slice(2, half) === body.slice(half + 3)) {
    const path = body.slice(2, half)
    return { from: path, to: path }
  }
  const separator = body.indexOf(' b/')
  if (body.startsWith('a/') && separator > 0) return { from: body.slice(2, separator), to: body.slice(separator + 3) }
  return { from: body, to: body }
}

/** Split a `jj diff --git` patch into files and numbered hunks for the full-diff view. */
export const parseGitPatch = (patch: string): PatchFile[] => {
  const sections = patch.split(/(?=^diff --git )/m).filter(section => section.startsWith('diff --git '))
  return sections.map(section => {
    const lines = section.replace(/\n$/, '').split('\n')
    const paths = headerPaths(lines[0] ?? '')
    let from = paths.from
    let to = paths.to
    let status: FileStatus = 'M'
    let binary = false
    const hunks: PatchHunk[] = []
    let rows: PatchRow[] = []
    let oldLine = 0
    let newLine = 0
    let previousOldEnd = 1
    let pendingGap: number | null = null
    for (const line of lines.slice(1)) {
      const header = HUNK_HEADER.exec(line)
      if (header !== null) {
        if (pendingGap !== null) hunks.push({ unmodifiedBefore: pendingGap, rows })
        const oldStart = Number(header[1])
        const oldCount = header[2] === undefined ? 1 : Number(header[2])
        oldLine = oldStart
        newLine = Number(header[3])
        const effectiveStart = oldCount === 0 ? oldStart + 1 : oldStart
        pendingGap = Math.max(0, effectiveStart - previousOldEnd)
        previousOldEnd = effectiveStart + oldCount
        rows = []
        continue
      }
      if (pendingGap === null) {
        if (line.startsWith('new file mode')) status = 'A'
        else if (line.startsWith('deleted file mode')) status = 'D'
        else if (line.startsWith('rename from ')) {
          status = 'R'
          from = line.slice('rename from '.length)
        } else if (line.startsWith('rename to ')) to = line.slice('rename to '.length)
        else if (line.startsWith('copy from ')) {
          status = 'C'
          from = line.slice('copy from '.length)
        } else if (line.startsWith('copy to ')) to = line.slice('copy to '.length)
        else if (line.startsWith('Binary files ') || line === 'GIT binary patch') binary = true
        else {
          const oldPath = stripPrefix(line, '--- a/')
          const newPath = stripPrefix(line, '+++ b/')
          if (oldPath !== null) from = oldPath
          if (newPath !== null) to = newPath
        }
        continue
      }
      if (line.startsWith('\\')) continue
      if (line.startsWith('+')) {
        rows.push({ kind: 'addition', oldLine: null, newLine, text: line.slice(1) })
        newLine += 1
      } else if (line.startsWith('-')) {
        rows.push({ kind: 'deletion', oldLine, newLine: null, text: line.slice(1) })
        oldLine += 1
      } else if (line.startsWith(' ') || line.length === 0) {
        rows.push({ kind: 'context', oldLine, newLine, text: line.slice(1) })
        oldLine += 1
        newLine += 1
      }
    }
    if (pendingGap !== null) hunks.push({ unmodifiedBefore: pendingGap, rows })
    return { path: status === 'D' ? from : to, previousPath: from === to ? null : from, status, binary, hunks }
  })
}
