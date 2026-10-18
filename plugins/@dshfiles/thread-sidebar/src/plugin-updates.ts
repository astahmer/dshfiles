import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { JsonText } from './json-text.js'

/** The slice of the Host's client module registry used to locate each loaded plugin package. */
export interface PluginRegistry {
  readonly ids: () => readonly string[]
  readonly clientPath: (id: string) => string | undefined
}

const entryTargetSchema = z.union([z.string(), z.object({ import: z.string().optional(), default: z.string().optional() })])
const manifestSchema = z.object({
  name: z.string(),
  main: z.string().optional(),
  exports: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
})

const readOptional = async (path: string): Promise<string> => readFile(path, 'utf8').catch(() => '')

/** A file's identity hint: any change here invalidates the cached hash without reading the bytes. */
interface FileRevision {
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}

/** What the Host resolved at boot for one package: its manifest, its Host entry and its bundle patch. */
interface ResolvedPackage {
  readonly directory: string
  readonly hostEntry: string
}

const revisionOf = async (path: string): Promise<FileRevision | undefined> => {
  const info = await stat(path).catch(() => undefined)
  return info === undefined ? undefined : { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs }
}

/** Same revision means the bytes are the ones already hashed; a missing hint on either side forces a re-read. */
const sameRevision = (left: FileRevision | undefined, right: FileRevision | undefined): boolean =>
  // A file that is still absent on both sides is unchanged; one side appearing or vanishing is not.
  left === undefined || right === undefined ? left === right : left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs

/**
 * The Host facts one package serves: its manifest, its Host entry and its bundle patch. The client bundle is left out
 * because the Host hot-reloads it. Null when the package root cannot be found from its bundle.
 */
const fingerprint = async (
  id: string,
  clientPath: string,
  resolved?: ResolvedPackage,
): Promise<{
  readonly hash: string
  readonly revisions: readonly (FileRevision | undefined)[]
  readonly directory: string
  readonly hostEntry: string
} | null> => {
  let directory = resolved?.directory ?? dirname(clientPath)
  let hostEntry = resolved?.hostEntry
  for (;;) {
    if (hostEntry !== undefined && resolved !== undefined) break
    const raw = await readOptional(join(directory, 'package.json'))
    const manifest = JsonText.decode(manifestSchema, raw)
    if (manifest?.success === true && manifest.data.name === id) {
      const exported = typeof manifest.data.exports === 'string' ? manifest.data.exports : entryTargetSchema.safeParse(manifest.data.exports?.['.']).data
      hostEntry = typeof exported === 'string' ? exported : (exported?.import ?? exported?.default ?? manifest.data.main ?? 'index.js')
      break
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
  if (hostEntry === undefined) return null
  const paths = [join(directory, 'package.json'), join(directory, hostEntry), join(directory, 'cordis.patch.yml')]
  const revisions = await Promise.all(paths.map(revisionOf))
  const files = await Promise.all(paths.map(readOptional))
  const digest = files.reduce((hash, file) => hash.update(file).update('\0'), createHash('sha256')).digest('hex')
  return { hash: digest, revisions, directory, hostEntry }
}

/** How many plugins one scan probes at once; a workspace with many plugins must not open a read per plugin. */
const SCAN_CONCURRENCY = 4
/** A revision hint is not proof forever: past this age the bytes are read and hashed again. */
const REHASH_AFTER_MS = 30_000

/**
 * Remembers each plugin package as first seen (at boot, or when it joins the graph) and reports the ones whose Host
 * code or manifest changed on disk since, which only a restart loads. Content hashes, not mtimes, so rebuilding every
 * UI plugin with identical output flags nothing. The resolved package topology and each file's revision are cached,
 * so a check that finds every file at the revision its hash came from reads nothing at all; a metadata change is only
 * an invalidation hint, so the bytes are read and hashed again before anything is reported.
 */
export const createPluginUpdateWatch = (
  registry: PluginRegistry,
  options: {
    readonly now?: () => number
    /** Test seam: how long a revision hint is trusted without re-reading the bytes. */
    readonly rehashAfterMs?: number
  } = {},
) => {
  const now = options.now ?? Date.now
  const rehashAfterMs = options.rehashAfterMs ?? REHASH_AFTER_MS
  const baselines = new Map<string, Promise<string | null>>()
  const topology = new Map<string, ResolvedPackage>()
  const hashes = new Map<string, { readonly hash: string; readonly revisions: readonly (FileRevision | undefined)[]; readonly hashedAt: number }>()
  let scan: Promise<string[]> | undefined

  const current = async (id: string): Promise<string | null> => {
    const clientPath = registry.clientPath(id)
    if (clientPath === undefined) return null
    const resolved = topology.get(id)
    const cached = hashes.get(id)
    if (resolved !== undefined && cached !== undefined && now() - cached.hashedAt < rehashAfterMs) {
      const paths = [join(resolved.directory, 'package.json'), join(resolved.directory, resolved.hostEntry), join(resolved.directory, 'cordis.patch.yml')]
      const revisions = await Promise.all(paths.map(revisionOf))
      if (revisions.every((revision, index) => sameRevision(revision, cached.revisions[index]))) return cached.hash
    }
    const next = await fingerprint(id, clientPath, resolved).catch(() => null)
    if (next === null) return null
    topology.set(id, { directory: next.directory, hostEntry: next.hostEntry })
    hashes.set(id, { hash: next.hash, revisions: next.revisions, hashedAt: now() })
    return next.hash
  }

  const remember = (): void => {
    for (const id of registry.ids()) if (!baselines.has(id)) baselines.set(id, current(id))
  }

  const scanOnce = async (): Promise<string[]> => {
    const ids = registry.ids()
    const changed: string[] = []
    let nextIndex = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < ids.length) {
        // oxlint-disable-next-line antislop/no-passthrough-variable -- Reserve the slot before awaiting; other workers advance nextIndex.
        const index = nextIndex
        nextIndex += 1
        const id = ids[index]
        if (id === undefined) continue
        const [before, now] = await Promise.all([baselines.get(id), current(id)])
        if (before !== null && before !== undefined && now !== null && before !== now) {
          changed.push(id)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, ids.length) }, () => worker()))
    // A plugin that left the graph must not keep its topology or hash alive.
    const registered = new Set(ids)
    for (const id of [...hashes.keys()]) {
      if (registered.has(id)) continue
      hashes.delete(id)
      topology.delete(id)
    }
    return changed.sort()
  }

  return {
    remember,
    pending: async (): Promise<string[]> => {
      remember()
      // One scan at a time: a poll that lands while another runs joins it instead of rehashing everything again.
      scan ??= scanOnce().finally(() => {
        scan = undefined
      })
      return scan
    },
  }
}

/** One client bundle revision: the entry id and the artifact revision a page runs for it. */
export interface ClientEntryRevision {
  readonly id: string
  readonly rev: string
}

/**
 * Which client bundles a page must reload for: the ones it runs at another revision than the Host serves, plus
 * entries the Host serves that the page never loaded. A page that picked a rebuild up over hot reload reports the
 * current revision and drops off this list, so the answer names only what a reload would actually change.
 */
export const staleClientEntries = ({
  page,
  served,
}: {
  readonly page: readonly ClientEntryRevision[]
  readonly served: readonly ClientEntryRevision[]
}): { readonly stale: string[]; readonly added: string[] } => {
  const loaded = new Map(page.map(entry => [entry.id, entry.rev]))
  const current = new Map(served.map(entry => [entry.id, entry.rev]))
  return {
    stale: page
      .filter(entry => current.get(entry.id) !== undefined && current.get(entry.id) !== entry.rev)
      .map(entry => entry.id)
      .sort(),
    added: served
      .filter(entry => !loaded.has(entry.id))
      .map(entry => entry.id)
      .sort(),
  }
}
