import { composerBaseSchema, type ComposerBase } from './composer-context-api.js'

export const COMPOSER_HEAD_TEMPLATE =
  '"{\\"changeId\\":" ++ stringify(self.change_id().shortest(8)).escape_json() ++ ' +
  '",\\"commitId\\":" ++ self.commit_id().short(12).escape_json() ++ ' +
  '",\\"bookmarks\\":[" ++ self.local_bookmarks().map(|b| b.name().escape_json()).join(",") ++ "]" ++ ' +
  '",\\"empty\\":" ++ self.empty() ++ ' +
  '",\\"conflict\\":" ++ self.conflict() ++ ' +
  '",\\"description\\":" ++ self.description().first_line().escape_json() ++ "}\\n"'

export const COMPOSER_BOOKMARKS_TEMPLATE = '"[" ++ self.local_bookmarks().map(|b| b.name().escape_json()).join(",") ++ "]\\n"'

export const COMPOSER_LOCAL_BOOKMARK_LIST_TEMPLATE = 'if(!self.remote(), self.name().escape_json() ++ "\\n")'

// `working_copies()` on a commit is empty in single-workspace repositories, so ask the workspace list instead.
export const COMPOSER_WORKSPACE_TEMPLATE = 'if(target.current_working_copy(), name.escape_json() ++ "\\n")'

export const COMPOSER_FILE_TEMPLATE = '"{\\"path\\":" ++ path.display().escape_json() ++ ",\\"status\\":" ++ status.escape_json() ++ "}\\n"'

/** Settings store the base as one string: `parent`, `trunk`, or a local bookmark name. */
export const composerBaseFromSetting = (value: unknown): ComposerBase => {
  if (value === 'trunk') return { kind: 'trunk' }
  if (typeof value !== 'string' || value === 'parent' || value.length === 0) return { kind: 'parent' }
  const bookmark = composerBaseSchema.safeParse({ kind: 'bookmark', name: value })
  return bookmark.success ? bookmark.data : { kind: 'parent' }
}

export const composerBaseSetting = (base: ComposerBase): string => (base.kind === 'bookmark' ? base.name : base.kind)

/** The revision the base names; empty when a bookmark does not exist. */
export const composerBaseTarget = (base: ComposerBase): string => {
  if (base.kind === 'parent') return '@-'
  if (base.kind === 'trunk') return 'trunk()'
  // The schema already excludes quotes and backslashes from bookmark names.
  return 'bookmarks(exact:' + JSON.stringify(base.name) + ')'
}

/** Diff range for `jj diff`: the working copy against its parents, or everything since it forked from the base. */
export const composerDiffRange = (base: ComposerBase): readonly string[] =>
  base.kind === 'parent' ? ['-r', '@'] : ['--from', 'fork_point(' + composerBaseTarget(base) + ' | @)', '--to', '@']

/** Totals from the last line of `jj diff --stat`; null when the summary line is missing (e.g. truncated output). */
export const parseStatTotals = (stdout: string): { files: number; additions: number; deletions: number } | null => {
  const lastLine = stdout.trimEnd().split(/\r?\n/).at(-1) ?? ''
  const match = /^\s*(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?\s*$/.exec(lastLine)
  if (match === null) return null
  return { files: Number(match[1]), additions: Number(match[2] ?? 0), deletions: Number(match[3] ?? 0) }
}

const unquoteGitPath = (value: string): string => {
  if (!value.startsWith('"')) return value
  try {
    const decoded: unknown = JSON.parse(value)
    return typeof decoded === 'string' ? decoded : value
  } catch {
    return value
  }
}

/** Per-file added/removed line counts of a `jj diff --git` patch, keyed by the post-change path (pre-change for deletions). */
export const parsePatchFileStats = (patch: string): { path: string; additions: number; deletions: number }[] =>
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
