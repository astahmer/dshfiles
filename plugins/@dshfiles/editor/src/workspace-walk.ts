import { isIgnored, parseGitignore, type IgnoreRule } from './gitignore.js'

const MAX_FILES = 20_000
const MAX_DIRECTORIES = 4_000
const PARALLEL_LISTS = 8
const PROGRESS_INTERVAL_MS = 200
/** Host `changes` watches one directory's direct entries, so only the shallowest directories get a stream each. */
export const MAX_WATCHED_DIRECTORIES = 64

export interface DirectoryEntry {
  readonly name: string
  readonly type: string
}
export type ListDirectory = (path: string, signal: AbortSignal) => Promise<{ readonly entries: readonly DirectoryEntry[] }>
export type ReadText = (path: string, signal: AbortSignal) => Promise<string>
export type WatchFrame = { readonly kind: 'ready' } | { readonly kind: 'change' }

export interface DirectoryListing {
  readonly files: readonly string[]
  readonly directories: readonly string[]
  /** Rules of this directory's own `.gitignore`. */
  readonly rules: readonly IgnoreRule[]
}
export type Directories = Map<string, DirectoryListing>

const IGNORED_DIRECTORIES = new Set(['.git', '.jj', 'node_modules'])

const joinPath = (parent: string, name: string): string => (parent === '' ? name : `${parent}/${name}`)

const ancestorsOf = (path: string): string[] => {
  if (path === '') return []
  const parts = path.split('/')
  return ['', ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))]
}

/** The workspace listing walk: breadth-first, `.gitignore`-aware, and capped so a huge tree cannot stall the palette. */
export class WorkspaceWalk {
  static depthOf = (path: string): number => (path === '' ? 0 : path.split('/').length)

  /** Shallowest first, so a relist pass applies a parent's removal before it decides about the children. */
  static sortedByDepth = (paths: Iterable<string>): readonly string[] =>
    [...paths].sort((left, right) => WorkspaceWalk.depthOf(left) - WorkspaceWalk.depthOf(right))

  /** List one directory and keep what neither the fixed skip list nor the `.gitignore` files from the root down drop. */
  static readDirectory = async (options: {
    readonly list: ListDirectory
    readonly readText: ReadText | undefined
    readonly directories: Directories
    readonly path: string
    readonly signal: AbortSignal
  }): Promise<DirectoryListing | null> => {
    const listing = await options.list(options.path, options.signal).catch(() => null)
    if (listing === null) return null
    const hasGitignore = listing.entries.some(entry => entry.name === '.gitignore' && entry.type === 'file')
    const text =
      hasGitignore && options.readText !== undefined ? await options.readText(joinPath(options.path, '.gitignore'), options.signal).catch(() => '') : ''
    const rules = text === '' ? [] : parseGitignore({ text, base: options.path })
    const chain = [...ancestorsOf(options.path).flatMap(ancestor => options.directories.get(ancestor)?.rules ?? []), ...rules]
    const files: string[] = []
    const directories: string[] = []
    for (const entry of listing.entries) {
      const path = joinPath(options.path, entry.name)
      const directory = entry.type === 'directory'
      if ((!directory && entry.type !== 'file') || (directory && IGNORED_DIRECTORIES.has(entry.name))) continue
      if (chain.length > 0 && isIgnored({ rules: chain, path, directory })) continue
      if (directory) directories.push(path)
      else files.push(path)
    }
    return { files, directories, rules }
  }

  /** Directories in breadth-first order from the listed ones, so caps keep the shallow files people open most. */
  static breadthFirst = (directories: Directories): string[] => {
    const order: string[] = []
    let level = directories.has('') ? [''] : []
    while (level.length > 0) {
      order.push(...level)
      level = level.flatMap(path => directories.get(path)?.directories.filter(child => directories.has(child)) ?? [])
    }
    return order
  }

  static flatten = (directories: Directories): { readonly files: readonly string[]; readonly truncated: boolean } => {
    const files = WorkspaceWalk.breadthFirst(directories).flatMap(path => directories.get(path)?.files ?? [])
    return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES }
  }

  /**
   * Breadth-first listing from `roots` into `directories`; unlistable directories are skipped. Stops at the file and
   * directory caps, counting what `directories` already holds.
   */
  static walkInto = async (options: {
    readonly list: ListDirectory
    readonly readText: ReadText | undefined
    readonly signal: AbortSignal
    readonly directories: Directories
    readonly roots: readonly string[]
    readonly onProgress?: () => void
  }): Promise<boolean> => {
    let level = [...options.roots]
    let fileCount = [...options.directories.values()].reduce((sum, listing) => sum + listing.files.length, 0)
    let truncated = false
    let progressAt = Date.now()
    while (level.length > 0 && !truncated) {
      const next: string[] = []
      for (let start = 0; start < level.length && !truncated; start += PARALLEL_LISTS) {
        const batch = level.slice(start, start + PARALLEL_LISTS)
        const listings = await Promise.all(batch.map(path => WorkspaceWalk.readDirectory({ ...options, path })))
        options.signal.throwIfAborted()
        listings.forEach((listing, index) => {
          if (listing === null) return
          options.directories.set(batch[index] ?? '', listing)
          fileCount += listing.files.length
          next.push(...listing.directories)
        })
        if (fileCount >= MAX_FILES || options.directories.size + next.length > MAX_DIRECTORIES) truncated = true
        if (Date.now() - progressAt < PROGRESS_INTERVAL_MS) continue
        progressAt = Date.now()
        options.onProgress?.()
      }
      level = next
    }
    return truncated
  }

  static walkWorkspaceFiles = async (options: {
    readonly list: ListDirectory
    readonly readText?: ReadText
    readonly signal: AbortSignal
    readonly onProgress: (files: readonly string[]) => void
  }): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> => {
    const directories: Directories = new Map()
    const truncated = await WorkspaceWalk.walkInto({
      list: options.list,
      readText: options.readText,
      signal: options.signal,
      directories,
      roots: [''],
      onProgress: () => options.onProgress(WorkspaceWalk.flatten(directories).files),
    })
    const result = WorkspaceWalk.flatten(directories)
    return { files: result.files, truncated: truncated || result.truncated }
  }
}
