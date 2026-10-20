import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Subcommands that only read the repository view, whose output is a function of the operation head. */
const VIEW_READS: readonly (readonly string[])[] = [['log'], ['root'], ['diff'], ['show'], ['workspace', 'list'], ['bookmark', 'list'], ['op', 'log']]

const MAX_ENTRIES = 512

/**
 * Memoizes `jj --ignore-working-copy` view reads per operation head. Every jj spawn loads the repository view first,
 * which costs 80–340 ms on a store with dozens of workspaces, while these reads only change when an operation lands.
 * The key carries the store's `op_heads/heads` listing, read from disk before the command runs, so a later operation
 * misses the cache and an operation landing mid-read is paired with the older head.
 */
export class JjReadCache<Result> {
  private readonly results = new Map<string, Result>()
  private readonly inFlight = new Map<string, Promise<Result>>()
  private readonly opHeadsDirectories = new Map<string, string | null>()

  static isViewRead(args: readonly string[]): boolean {
    if (args[0] !== '--ignore-working-copy') return false
    const command = args.slice(1)
    return VIEW_READS.some(prefix => prefix.every((part, index) => command[index] === part))
  }

  /** Run a view read (see `isViewRead`), or answer it from the result of the same read at the same operation head. */
  read(input: {
    readonly args: readonly string[]
    readonly cwd: string
    readonly run: () => Promise<Result>
    readonly succeeded: (result: Result) => boolean
  }): Promise<Result> {
    const opHeads = this.opHeadsDirectory(input.cwd)
    if (opHeads === null) return input.run()
    let heads: string
    try {
      heads = readdirSync(opHeads).sort().join(',')
    } catch {
      return input.run()
    }
    const key = `${input.cwd}\u0000${heads}\u0000${input.args.join('\u0000')}`
    const cached = this.results.get(key)
    if (cached !== undefined) return Promise.resolve(cached)
    const pending = this.inFlight.get(key)
    if (pending !== undefined) return pending
    const read = input.run().then(result => {
      if (input.succeeded(result)) {
        this.results.set(key, result)
        if (this.results.size > MAX_ENTRIES) this.results.delete(this.results.keys().next().value ?? key)
      }
      return result
    })
    this.inFlight.set(key, read)
    return read.finally(() => this.inFlight.delete(key))
  }

  /** `op_heads/heads` of the store a directory belongs to, or null outside a jj workspace. */
  private opHeadsDirectory(cwd: string): string | null {
    const known = this.opHeadsDirectories.get(cwd)
    if (known !== undefined) return known
    let directory = resolve(cwd)
    let found: string | null = null
    while (found === null) {
      const marker = join(directory, '.jj', 'repo')
      if (existsSync(marker)) {
        const store = statSync(marker).isDirectory() ? marker : resolve(dirname(marker), readFileSync(marker, 'utf8').trim())
        found = join(store, 'op_heads', 'heads')
        break
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    this.opHeadsDirectories.set(cwd, found)
    return found
  }
}
