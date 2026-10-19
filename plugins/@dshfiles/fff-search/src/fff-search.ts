import type { FileFinder, GrepCursor } from '@ff-labs/fff-node'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

type GrepMatch = { path: string; lineNumber: number; line: string }
type GrepOutcome = z.infer<typeof FffSearch.grepOutcome>
type GlobOutcome = z.infer<typeof FffSearch.globOutcome>

/** Where a search runs: the index root and, inside it, an optional directory or file the caller narrowed to. */
type SearchScope = z.infer<typeof FffSearch.searchScope>

/**
 * The model-facing `grep`/`glob` contract mapped onto fff queries. fff reads query tokens shaped like paths or globs
 * (`src/`, `*.ts`, `!test/`) as constraints. A pattern with such a token is sent as a non-capturing regex group so it
 * stays a pattern, as ripgrep would read it; every other pattern goes bare, because the group defeats fff's literal
 * prefilter and measured 3-10x slower.
 */
export class FffSearch {
  static readonly maxGrepMatches = 250
  static readonly maxGlobPaths = 100
  static readonly maxLineChars = 2000
  /** Pages counted past the shown matches, so a broad pattern reports a useful total without scanning forever. */
  static readonly maxCountedPages = 8

  static readonly searchScope = z.object({ root: z.string(), directory: z.string().optional(), file: z.string().optional() })
  static readonly grepOutcome = z.object({
    matches: z.array(z.object({ path: z.string(), lineNumber: z.number(), line: z.string() })),
    total: z.number(),
    totalIsLowerBound: z.boolean(),
  })
  static readonly globOutcome = z.object({ paths: z.array(z.string()), total: z.number() })
  /** Host → worker. `warm` builds a root's index ahead of the first search. */
  static readonly workerRequest = z.discriminatedUnion('kind', [
    z.object({ id: z.number(), kind: z.literal('warm'), root: z.string() }),
    z.object({
      id: z.number(),
      kind: z.literal('grep'),
      scope: FffSearch.searchScope,
      pattern: z.string(),
      include: z.string().optional(),
      workingDirectory: z.string(),
    }),
    z.object({ id: z.number(), kind: z.literal('glob'), scope: FffSearch.searchScope, pattern: z.string(), workingDirectory: z.string() }),
  ])
  static readonly workerReply = z.union([
    z.object({ id: z.number(), ok: z.literal(true), value: z.unknown() }),
    z.object({ id: z.number(), ok: z.literal(false), error: z.string() }),
  ])

  /** Resolve the tool's optional `path` against the Agent's working directory into an index root and a narrowing. */
  static scope(options: { workingDirectory: string; path: string | undefined; isFile: (path: string) => boolean }): SearchScope {
    const target = options.path === undefined ? options.workingDirectory : resolve(options.workingDirectory, options.path)
    const inside = relative(options.workingDirectory, target)
    const outsideRoot = inside.startsWith('..') || isAbsolute(inside)
    const isFile = options.isFile(target)
    if (outsideRoot) {
      if (!isFile) return { root: target, directory: undefined, file: undefined }
      const parent = resolve(target, '..')
      return { root: parent, directory: undefined, file: relative(parent, target).split(sep).join('/') }
    }
    const posix = inside.split(sep).join('/')
    if (posix === '') return { root: options.workingDirectory, directory: undefined, file: undefined }
    if (!isFile) return { root: options.workingDirectory, directory: posix, file: undefined }
    const slash = posix.lastIndexOf('/')
    return { root: options.workingDirectory, directory: slash === -1 ? undefined : posix.slice(0, slash), file: posix }
  }

  static grep(options: { finder: FileFinder; scope: SearchScope; pattern: string; include: string | undefined; workingDirectory: string }): GrepOutcome {
    const constraints = [options.scope.directory === undefined ? undefined : `${options.scope.directory}/`, options.include]
    // A pattern with no regex syntax is a literal; fff's plain mode matches it fastest, as fff-mcp does for identifiers.
    const constraintShaped = options.pattern.split(/\s+/).some(token => /[/*?{}!]|\.\w+$/.test(token))
    const mode = constraintShaped || /[\\^$.|?*+()[\]{}]/.test(options.pattern) ? 'regex' : 'plain'
    const pattern = constraintShaped ? `(?:${options.pattern})` : options.pattern
    const query = [...constraints.filter(constraint => constraint !== undefined), pattern].join(' ')
    const matches: GrepMatch[] = []
    let total = 0
    let pages = 0
    let cursor: GrepCursor | null = null
    do {
      pages += 1
      // fff defaults to smart case; ripgrep, whose contract this tool keeps, is case-sensitive.
      const page = options.finder.grep(query, { mode, smartCase: false, pageSize: FffSearch.maxGrepMatches, cursor })
      if (!page.ok) throw new Error(`grep failed: ${page.error}`)
      if (page.value.regexFallbackError !== undefined) throw new Error(`grep pattern is not a valid regular expression: ${page.value.regexFallbackError}`)
      for (const item of page.value.items) {
        if (options.scope.file !== undefined && item.relativePath !== options.scope.file) continue
        total += 1
        if (matches.length >= FffSearch.maxGrepMatches) continue
        matches.push({
          path: FffSearch.#fromRoot(options.scope.root, item.relativePath, options.workingDirectory),
          lineNumber: item.lineNumber,
          line: item.lineContent.slice(0, FffSearch.maxLineChars),
        })
      }
      cursor = page.value.nextCursor
    } while (cursor !== null && pages < FffSearch.maxCountedPages)
    return { matches, total, totalIsLowerBound: cursor !== null }
  }

  static glob(options: { finder: FileFinder; scope: SearchScope; pattern: string; workingDirectory: string }): GlobOutcome {
    const anchored =
      options.scope.directory === undefined ? options.pattern : `${options.scope.directory}/${options.pattern.includes('/') ? '' : '**/'}${options.pattern}`
    const result = options.finder.glob(anchored, { pageSize: FffSearch.maxGlobPaths })
    if (!result.ok) throw new Error(`glob failed: ${result.error}`)
    return {
      paths: result.value.items.map(item => FffSearch.#fromRoot(options.scope.root, item.relativePath, options.workingDirectory)),
      total: result.value.totalMatched,
    }
  }

  static renderGrep(outcome: GrepOutcome): string {
    if (outcome.total === 0) return 'No matches found.'
    const total = outcome.totalIsLowerBound ? `more than ${outcome.total}` : String(outcome.total)
    const header =
      outcome.total > outcome.matches.length
        ? `Found ${outcome.matches.length} of ${total} matches; narrow the pattern, path or include to see the rest.`
        : `Found ${total} matches`
    const lines = [header]
    let currentPath: string | undefined
    for (const match of outcome.matches) {
      if (match.path !== currentPath) {
        currentPath = match.path
        lines.push('', `${match.path}:`)
      }
      lines.push(`  Line ${match.lineNumber}: ${match.line}`)
    }
    return lines.join('\n')
  }

  static renderGlob(outcome: GlobOutcome): string {
    if (outcome.total === 0) return 'No files found.'
    const header =
      outcome.total > outcome.paths.length
        ? `Found ${outcome.paths.length} of ${outcome.total} files; narrow the pattern or path to see the rest.`
        : `Found ${outcome.total} files`
    return [header, ...outcome.paths].join('\n')
  }

  static #fromRoot(root: string, relativePath: string, workingDirectory: string): string {
    return relative(workingDirectory, resolve(root, relativePath)).split(sep).join('/')
  }
}
