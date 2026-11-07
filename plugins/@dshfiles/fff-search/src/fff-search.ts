import type { FileFinder, GrepCursor } from '@ff-labs/fff-node'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import * as Schema from 'effect/Schema'

type GrepMatch = { path: string; lineNumber: number; line: string }
type GrepOutcome = typeof FffSearch.grepOutcome.Type
type GlobOutcome = typeof FffSearch.globOutcome.Type

/** Where a search runs: the index root and, inside it, an optional directory or file the caller narrowed to. */
type SearchScope = typeof FffSearch.searchScope.Type

/** A search the caller can fix: missing path, a root that swallows the workspace, or a pattern fff cannot compile. */
export class FffSearchError extends Schema.TaggedError<FffSearchError>()(
  'FffSearchError',
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'fff-search-failed' },
) {
  override get message(): string {
    return this.reason
  }
}

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

  static readonly searchScope = Schema.Struct({ root: Schema.String, directory: Schema.optionalKey(Schema.String), file: Schema.optionalKey(Schema.String) })
  static readonly grepOutcome = Schema.Struct({
    matches: Schema.Array(Schema.Struct({ path: Schema.String, lineNumber: Schema.Number, line: Schema.String })),
    total: Schema.Number,
    totalIsLowerBound: Schema.Boolean,
  })
  static readonly globOutcome = Schema.Struct({ paths: Schema.Array(Schema.String), total: Schema.Number })
  /** Host → worker. `warm` builds a root's index ahead of the first search. */
  static readonly workerRequest = Schema.Union([
    Schema.Struct({ id: Schema.Number, kind: Schema.Literal('warm'), root: Schema.String }),
    Schema.Struct({
      id: Schema.Number,
      kind: Schema.Literal('grep'),
      scope: FffSearch.searchScope,
      pattern: Schema.String,
      include: Schema.optionalKey(Schema.String),
      workingDirectory: Schema.String,
    }),
    Schema.Struct({ id: Schema.Number, kind: Schema.Literal('glob'), scope: FffSearch.searchScope, pattern: Schema.String, workingDirectory: Schema.String }),
  ])
  static readonly workerReply = Schema.Union([
    Schema.Struct({ id: Schema.Number, ok: Schema.Literal(true), value: Schema.Unknown }),
    Schema.Struct({ id: Schema.Number, ok: Schema.Literal(false), error: Schema.String }),
  ])

  /** Resolve the tool's optional `path` to the absolute target the Host stats, expanding `~` as the model means it. */
  static target(options: { workingDirectory: string; path: string | undefined; homeDirectory?: string }): string {
    if (options.path === undefined) return options.workingDirectory
    const homeDirectory = options.homeDirectory ?? homedir()
    const expanded = options.path === '~' ? homeDirectory : options.path.startsWith(`~${sep}`) ? resolve(homeDirectory, options.path.slice(2)) : options.path
    return isAbsolute(expanded) ? expanded : resolve(options.workingDirectory, expanded)
  }

  /**
   * Resolve the target into an index root and a narrowing inside it. A missing path is a caller error, and a root that
   * contains the Agent's workspace is refused: one search at `~/dev` would index every checkout under it.
   */
  static scope(options: { workingDirectory: string; path: string | undefined; target: string; stats: { isFile: boolean } | undefined }): SearchScope {
    if (options.path === undefined) return { root: options.workingDirectory }
    if (options.stats === undefined) throw new FffSearchError({ reason: `path does not exist: ${options.path}` })
    const inside = relative(options.workingDirectory, options.target)
    const outsideRoot = inside.startsWith('..') || isAbsolute(inside)
    const parent = resolve(options.target, '..')
    const scope: SearchScope = outsideRoot
      ? options.stats.isFile
        ? { root: parent, file: relative(parent, options.target).split(sep).join('/') }
        : { root: options.target }
      : FffSearch.#inside({ workingDirectory: options.workingDirectory, inside: inside.split(sep).join('/'), isFile: options.stats.isFile })
    FffSearch.#refuseWorkspaceAncestor({ root: scope.root, workingDirectory: options.workingDirectory, path: options.path })
    return scope
  }

  static #inside(options: { workingDirectory: string; inside: string; isFile: boolean }): SearchScope {
    if (options.inside === '') return { root: options.workingDirectory }
    if (!options.isFile) return { root: options.workingDirectory, directory: options.inside }
    const slash = options.inside.lastIndexOf('/')
    return slash === -1
      ? { root: options.workingDirectory, file: options.inside }
      : { root: options.workingDirectory, directory: options.inside.slice(0, slash), file: options.inside }
  }

  static #refuseWorkspaceAncestor(options: { root: string; workingDirectory: string; path: string }): void {
    const inside = relative(options.root, options.workingDirectory)
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return
    throw new FffSearchError({
      reason: `path ${options.path} is outside the workspace and contains it; search from ${options.workingDirectory} or a path inside it`,
    })
  }

  /**
   * fff reads the first token of a grep query as a glob constraint, so a wildcard-only
   * include (`*`, `**`, `**​/*`) becomes `* pattern`: with a regex pattern the parser then
   * fails with "repetition operator missing expression" (24 hits across 14 Sessions in one
   * week). Such an include filters nothing, so it is dropped instead of narrowing the query.
   */
  static includeConstraint(include: string | undefined): string | undefined {
    if (include === undefined) return undefined
    const trimmed = include.trim()
    return /^\*{1,2}(?:\/\*{1,2})?$/u.test(trimmed) ? undefined : trimmed
  }

  static grep(options: { finder: FileFinder; scope: SearchScope; pattern: string; include: string | undefined; workingDirectory: string }): GrepOutcome {
    const constraints = [options.scope.directory === undefined ? undefined : `${options.scope.directory}/`, FffSearch.includeConstraint(options.include)]
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
      if (!page.ok) throw new FffSearchError({ reason: `grep failed: ${page.error}` })
      if (page.value.regexFallbackError !== undefined) {
        throw new FffSearchError({ reason: `grep pattern is not a valid regular expression: ${page.value.regexFallbackError}` })
      }
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
    if (!result.ok) throw new FffSearchError({ reason: `glob failed: ${result.error}` })
    const items = options.scope.file === undefined ? result.value.items : result.value.items.filter(item => item.relativePath === options.scope.file)
    return {
      paths: items.map(item => FffSearch.#fromRoot(options.scope.root, item.relativePath, options.workingDirectory)),
      total: options.scope.file === undefined ? result.value.totalMatched : items.length,
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
