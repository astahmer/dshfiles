import { decodeJsonSafe, type JsonValue } from '@dshfiles/dshx/json'
import { z } from 'zod'
import { composerBaseSchema, type ComposerBase } from './composer-context-api.js'

export const COMPOSER_HEAD_TEMPLATE =
  '"{\\"changeId\\":" ++ stringify(self.change_id().shortest(8)).escape_json() ++ ' +
  '",\\"commitId\\":" ++ self.commit_id().short(12).escape_json() ++ ' +
  '",\\"bookmarks\\":[" ++ self.local_bookmarks().map(|b| b.name().escape_json()).join(",") ++ "]" ++ ' +
  '",\\"empty\\":" ++ self.empty() ++ ' +
  '",\\"conflict\\":" ++ self.conflict() ++ ' +
  '",\\"description\\":" ++ self.description().first_line().escape_json() ++ "}\\n"'

export const COMPOSER_BOOKMARKS_TEMPLATE = '"[" ++ self.local_bookmarks().map(|b| b.name().escape_json()).join(",") ++ "]\\n"'

export const COMPOSER_BASE_TEMPLATE =
  '"{\\"commitId\\":" ++ self.commit_id().short(64).escape_json() ++ ' +
  '",\\"bookmarks\\":[" ++ self.local_bookmarks().map(|b| b.name().escape_json()).join(",") ++ "]}" ++ "\\n"'

export const COMPOSER_LOCAL_BOOKMARK_LIST_TEMPLATE = 'if(!self.remote(), self.name().escape_json() ++ "\\n")'
export const COMPOSER_REMOTE_BOOKMARK_LIST_TEMPLATE = 'self.remote_bookmarks().map(|b| b.name() ++ "@" ++ b.remote()).join("\\n") ++ "\\n"'

// `working_copies()` on a commit is empty in single-workspace repositories, so ask the workspace list instead.
export const COMPOSER_WORKSPACE_TEMPLATE = 'if(target.current_working_copy(), name.escape_json() ++ "\\n")'

export const COMPOSER_FILE_TEMPLATE = '"{\\"path\\":" ++ path.display().escape_json() ++ ",\\"status\\":" ++ status.escape_json() ++ "}\\n"'

/** Settings store the base as one string: `main`, `parent`, `trunk`, or an encoded remote bookmark. */
const defaultComposerBase: ComposerBase = { kind: 'bookmark', name: 'main' }
const REMOTE_BASE_PREFIX = 'remote-base='

export const composerBaseFromSetting = (value: JsonValue | undefined): ComposerBase => {
  const parsed = z.string().max(512).safeParse(value)
  if (!parsed.success || parsed.data.length === 0) return defaultComposerBase
  if (parsed.data === 'trunk') return { kind: 'trunk' }
  if (parsed.data === 'parent') return { kind: 'parent' }
  if (parsed.data.startsWith(REMOTE_BASE_PREFIX)) {
    try {
      const remoteBase = decodeJsonSafe(composerBaseSchema, decodeURIComponent(parsed.data.slice(REMOTE_BASE_PREFIX.length)))
      return remoteBase.success && remoteBase.data.kind === 'remoteBookmark' ? remoteBase.data : defaultComposerBase
    } catch {
      return defaultComposerBase
    }
  }
  const bookmark = composerBaseSchema.safeParse({ kind: 'bookmark', name: parsed.data })
  return bookmark.success ? bookmark.data : defaultComposerBase
}

export const composerBaseSetting = (base: ComposerBase): string => {
  if (base.kind === 'remoteBookmark') return REMOTE_BASE_PREFIX + encodeURIComponent(JSON.stringify(base))
  return base.kind === 'bookmark' ? base.name : base.kind
}

/** The revision the base names; empty when a bookmark does not exist. */
const composerBaseTarget = (base: ComposerBase): string => {
  if (base.kind === 'parent') return '@-'
  if (base.kind === 'trunk') return 'trunk()'
  if (base.kind === 'remoteBookmark') {
    return 'remote_bookmarks(exact:' + JSON.stringify(base.name) + ', remote=exact:' + JSON.stringify(base.remote) + ')'
  }
  // The schema already excludes quotes and backslashes from bookmark names.
  return 'bookmarks(exact:' + JSON.stringify(base.name) + ')'
}

/** Diff range for `jj diff`: the working copy against its parents, or from its fork point with the selected base. */
const composerDiffRange = (base: ComposerBase): readonly string[] =>
  base.kind === 'parent' ? ['-r', '@'] : ['--from', 'fork_point(' + composerBaseTarget(base) + ' | @)', '--to', '@']

/** Exact ancestry counts use one template character per revision, so bounded output also bounds the count. */
const parseRevisionCount = (stdout: string, truncated: boolean): number | null => {
  if (truncated || !/^x*$/.test(stdout)) return null
  return stdout.length
}

const revisionCountRevsets = (targetCommitId: string) => ({
  ahead: '::@ ~ ::' + targetCommitId,
  behind: '::' + targetCommitId + ' ~ ::@',
})

const revisionSummary = (input: {
  readonly baseLabel: string
  readonly baseFound: boolean
  readonly counts: { readonly ahead: number; readonly behind: number } | null | undefined
}): string => {
  if (!input.baseFound) return input.baseLabel + ' unavailable'
  if (input.counts === null || input.counts === undefined) return '@ vs ' + input.baseLabel + ': revision count unavailable'
  if (input.counts.ahead === 0 && input.counts.behind === 0) return '@ matches ' + input.baseLabel
  const ahead = input.counts.ahead > 0 ? `${String(input.counts.ahead)} only on @` : null
  const behind = input.counts.behind > 0 ? `${String(input.counts.behind)} only on ${input.baseLabel}` : null
  return '@ vs ' + input.baseLabel + ': ' + [ahead, behind].filter((summary): summary is string => summary !== null).join(' · ')
}

/** Totals from the last line of `jj diff --stat`; null when the summary line is missing (e.g. truncated output). */
const parseStatTotals = (stdout: string): { files: number; additions: number; deletions: number } | null => {
  const lastLine = stdout.trimEnd().split(/\r?\n/).at(-1) ?? ''
  const match = /^\s*(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?\s*$/.exec(lastLine)
  if (match === null) return null
  return { files: Number(match[1]), additions: Number(match[2] ?? 0), deletions: Number(match[3] ?? 0) }
}

/** A quoted path in a git patch is one JSON string literal. */
const quotedGitPathSchema = z.string()

const unquoteGitPath = (value: string): string => {
  if (!value.startsWith('"')) return value
  try {
    const decoded = decodeJsonSafe(quotedGitPathSchema, value)
    return decoded.success ? decoded.data : value
  } catch {
    return value
  }
}

/** Per-file added/removed line counts of a `jj diff --git` patch, keyed by the post-change path (pre-change for deletions). */
const parsePatchFileStats = (patch: string): { path: string; additions: number; deletions: number }[] =>
  patch
    .split(/(?=^diff --git )/m)
    .filter(section => section.startsWith('diff --git '))
    .map(section => {
      let additions = 0
      let deletions = 0
      let oldPath: string | null = null
      let newPath: string | null = null
      let inHunk = false
      for (const line of section.split('\n')) {
        if (!inHunk && line.startsWith('--- ')) oldPath = line.slice(4)
        else if (!inHunk && line.startsWith('+++ ')) newPath = line.slice(4)
        else if (line.startsWith('@@')) inHunk = true
        else if (inHunk && line.startsWith('+')) additions += 1
        else if (inHunk && line.startsWith('-')) deletions += 1
      }
      const header = /^diff --git a\/(.*) b\/(.*)$/m.exec(section)
      const chosen = newPath !== null && newPath !== '/dev/null' ? newPath : oldPath
      const path = chosen === null || chosen === '/dev/null' ? (header?.[2] ?? '') : unquoteGitPath(chosen).replace(/^[ab]\//, '')
      return { path, additions, deletions }
    })

export class ComposerContextModel {
  static readonly composerBaseSetting = composerBaseSetting
  static readonly composerBaseTarget = composerBaseTarget
  static readonly composerDiffRange = composerDiffRange
  static readonly parseRevisionCount = parseRevisionCount
  static readonly revisionCountRevsets = revisionCountRevsets
  static readonly revisionSummary = revisionSummary
  static readonly parsePatchFileStats = parsePatchFileStats
  static readonly parseStatTotals = parseStatTotals
}
