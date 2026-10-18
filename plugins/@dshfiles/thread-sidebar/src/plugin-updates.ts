import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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

/**
 * What the Host resolved at boot for one package: its manifest, its Host entry and its bundle patch. The client
 * bundle is left out because the Host hot-reloads it. Null when the package root cannot be found from its bundle.
 */
const fingerprint = async (id: string, clientPath: string): Promise<string | null> => {
  let directory = dirname(clientPath)
  for (;;) {
    const raw = await readOptional(join(directory, 'package.json'))
    const manifest = JsonText.decode(manifestSchema, raw)
    if (manifest?.success === true && manifest.data.name === id) {
      const exported = typeof manifest.data.exports === 'string' ? manifest.data.exports : entryTargetSchema.safeParse(manifest.data.exports?.['.']).data
      const hostEntry = typeof exported === 'string' ? exported : (exported?.import ?? exported?.default ?? manifest.data.main ?? 'index.js')
      const files = await Promise.all([raw, readOptional(join(directory, hostEntry)), readOptional(join(directory, 'cordis.patch.yml'))])
      return files.reduce((hash, file) => hash.update(file).update('\0'), createHash('sha256')).digest('hex')
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/**
 * Remembers each plugin package as first seen (at boot, or when it joins the graph) and reports the ones whose Host
 * code or manifest changed on disk since, which only a restart loads. Content hashes, not mtimes, so rebuilding
 * every UI plugin with identical output flags nothing.
 */
export const createPluginUpdateWatch = (registry: PluginRegistry) => {
  const baselines = new Map<string, Promise<string | null>>()
  const current = (id: string): Promise<string | null> => {
    const clientPath = registry.clientPath(id)
    return clientPath === undefined ? Promise.resolve(null) : fingerprint(id, clientPath).catch(() => null)
  }
  const remember = (): void => {
    for (const id of registry.ids()) if (!baselines.has(id)) baselines.set(id, current(id))
  }
  return {
    remember,
    pending: async (): Promise<string[]> => {
      remember()
      const changed = await Promise.all(
        registry.ids().map(async id => {
          const [before, now] = await Promise.all([baselines.get(id), current(id)])
          return before !== null && before !== undefined && now !== null && before !== now ? [id] : []
        }),
      )
      return changed.flat().sort()
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
