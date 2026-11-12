import { basename, dirname, extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'

const MAX_SUGGESTIONS = 5
/** Directories one project walk may list before it gives up; a miss should cost a fraction of a second. */
const MAX_DIRECTORIES = 2000
const MAX_DEPTH = 8
/** A hint is optional: past this budget the read reports plain FS_NOT_FOUND. */
const DEADLINE_MS = 500
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'target', 'coverage'])

const stem = (name: string): string => {
  const extension = extname(name)
  return extension.length === 0 ? name : name.slice(0, -extension.length)
}

/** Levenshtein distance, abandoned once every cell of a row exceeds `bound`. */
const editDistance = (left: string, right: string, bound: number): number => {
  if (Math.abs(left.length - right.length) > bound) return bound + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1)
      current.push(Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, substitution))
    }
    if (Math.min(...current) > bound) return bound + 1
    previous = current
  }
  return previous[right.length] ?? bound + 1
}

/** How close `name` is to the missing `wanted` basename, or `undefined` when it is not a plausible substitute. */
const closeness = (wanted: string, name: string): number | undefined => {
  if (name === wanted) return undefined
  const lowerWanted = wanted.toLowerCase()
  const lowerName = name.toLowerCase()
  if (lowerName === lowerWanted) return 0
  if (stem(lowerName) === stem(lowerWanted)) return 1
  const bound = lowerWanted.length >= 8 ? 2 : 1
  if (lowerWanted.length < 3) return undefined
  const distance = editDistance(lowerWanted, lowerName, bound)
  return distance <= bound ? 1 + distance : undefined
}

/** Names in a directory that look like the missing one: other case, other extension, or a small typo; closest first. */
export const closeNames = (input: { readonly wanted: string; readonly names: readonly string[] }): string[] =>
  input.names
    .flatMap(name => {
      const score = closeness(input.wanted, name)
      return score === undefined ? [] : [{ name, score }]
    })
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
    .slice(0, MAX_SUGGESTIONS)
    .map(match => match.name)

const listNames = async (ctx: Context, target: FsTarget, signal: AbortSignal | undefined) => {
  try {
    return await ctx.fs.listDir(target, signal)
  } catch (error) {
    if (signal?.aborted === true) throw error
    return []
  }
}

/** Files named like `wanted` (any case) under the project root, breadth first, skipping hidden and build directories. */
const findInProject = async (input: {
  readonly ctx: Context
  readonly wanted: string
  readonly root: FsTarget
  readonly signal: AbortSignal | undefined
}): Promise<string[]> => {
  const lowerWanted = input.wanted.toLowerCase()
  const hits: string[] = []
  const queue: { readonly target: FsTarget; readonly path: string; readonly depth: number }[] = [{ target: input.root, path: '', depth: 0 }]
  for (let listed = 0; listed < MAX_DIRECTORIES && hits.length < MAX_SUGGESTIONS; listed += 1) {
    const next = queue.shift()
    if (next === undefined) break
    for (const entry of await listNames(input.ctx, next.target, input.signal)) {
      const path = next.path.length === 0 ? entry.name : `${next.path}/${entry.name}`
      if (entry.type === 'file' && entry.name.toLowerCase() === lowerWanted) hits.push(path)
      const walkable = entry.type === 'directory' && !entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name) && next.depth < MAX_DEPTH
      if (walkable) queue.push({ target: entry.target, path, depth: next.depth + 1 })
    }
  }
  return hits.sort((left, right) => left.length - right.length || left.localeCompare(right)).slice(0, MAX_SUGGESTIONS)
}

/**
 * Paths the model probably meant by a missing `requestedPath`: close names in its directory, then files with the same
 * name elsewhere in the project. Listing goes through `ctx.fs`, so the provider's own resolution rules apply. Never
 * throws: a failure, cancellation or the deadline keeps the suggestions found so far, so the caller's FS_NOT_FOUND
 * error survives.
 */
export const suggestMissingPaths = async (input: {
  readonly ctx: Context
  readonly requestedPath: string
  readonly resolveOptions: { readonly cwd?: string; readonly signal?: AbortSignal }
}): Promise<string[]> => {
  const { ctx, requestedPath } = input
  const signal = AbortSignal.any([AbortSignal.timeout(DEADLINE_MS), ...(input.resolveOptions.signal === undefined ? [] : [input.resolveOptions.signal])])
  const resolveOptions = { ...input.resolveOptions, signal }
  const wanted = basename(requestedPath)
  const directory = dirname(requestedPath)
  const siblings: string[] = []
  try {
    const directoryTarget = await ctx.fs.resolve(directory, resolveOptions)
    const directoryInfo = await ctx.fs.stat(directoryTarget, signal)
    if (directoryInfo?.type === 'directory') {
      const names = (await listNames(ctx, directoryTarget, signal)).map(entry => entry.name)
      siblings.push(...closeNames({ wanted, names }).map(name => (directory === '.' ? name : join(directory, name))))
    }
    if (siblings.length >= MAX_SUGGESTIONS) return siblings
    const root = await ctx.fs.resolve('.', resolveOptions)
    const elsewhere = (await findInProject({ ctx, wanted, root, signal })).filter(path => path !== requestedPath && !siblings.includes(path))
    return [...siblings, ...elsewhere].slice(0, MAX_SUGGESTIONS)
  } catch {
    return siblings
  }
}
