import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'

/** Why a rebuilt client bundle must wait: the Host code it pairs with is not the code the Host loaded. */
export type GateReason = 'host-artifact-changed'

export interface GateFacts {
  readonly hostPath: string | undefined
  /** Digest of the Host artifact at the moment the running Host loaded it. */
  readonly loaded: string | undefined
  /** Digest of the Host artifact currently on disk. */
  readonly disk: string | undefined
}

interface GateRecord {
  readonly id: string
  readonly hostPath: string | undefined
  loaded: string | undefined
  disk: string | undefined
}

export type GateVerdict = { readonly action: 'apply' } | { readonly action: 'defer'; readonly reason: GateReason }

/** The three shapes a package can declare its entry with, normalized to one path string. */
const exportsEntrySchema = z.union([
  z.string().min(1),
  z.object({ '.': z.object({ default: z.string().min(1) }) }).transform(value => value['.'].default),
  z.object({ '.': z.string().min(1) }).transform(value => value['.']),
])

const manifestSchema = z.object({
  exports: z.unknown().optional(),
  main: z.string().min(1).optional(),
})

/** Read one file's content digest, or undefined when it does not exist (a client-only package). */
export const digestOf = (path: string): string | undefined => {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return undefined
  }
}

const fileExists = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const entryOf = (manifest: z.infer<typeof manifestSchema>): string | undefined => {
  if (manifest.exports !== undefined) {
    const parsed = exportsEntrySchema.safeParse(manifest.exports)
    if (parsed.success) return parsed.data
  }
  return manifest.main
}

const packageRootOf = (clientPath: string): string | undefined => {
  let directory = dirname(clientPath)
  for (let depth = 0; depth < 4; depth += 1) {
    if (fileExists(join(directory, 'package.json'))) return directory
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
  return undefined
}

/**
 * The Host artifact one client bundle pairs with: the package's own entry, read
 * from its manifest rather than assumed from a `dist/` convention, because native
 * packages ship `lib/index.js` and owned bundles ship `dist/index.js`.
 */
export const hostArtifactOf = (clientPath: string): string | undefined => {
  const root = packageRootOf(clientPath)
  if (root === undefined) return undefined
  let raw: string
  try {
    raw = readFileSync(join(root, 'package.json'), 'utf8')
  } catch {
    return undefined
  }
  const manifest = manifestSchema.safeParse(JSON.parse(raw))
  if (!manifest.success) return undefined
  const entry = entryOf(manifest.data)
  if (entry === undefined) return undefined
  const absolute = isAbsolute(entry) ? entry : resolve(root, entry)
  return fileExists(absolute) ? absolute : undefined
}

/**
 * Decides whether a rebuilt client bundle may be applied.
 *
 * Deferring is the rollback: the browser only tears the old client code down when
 * it receives the `rebuilt` frame, so withholding that frame keeps the last-good
 * code live. There is no undo after a reload, because the Host serves the current
 * file for every rev.
 */
export class HmrGateModel {
  private readonly records = new Map<string, GateRecord>()

  /** First sight of a package: the Host has just loaded it, so disk and loaded agree. */
  track(id: string, hostPath: string | undefined, digest: string | undefined): GateVerdict {
    this.records.set(id, { id, hostPath, loaded: digest, disk: digest })
    return { action: 'apply' }
  }

  /** A client bundle changed on disk: apply only while its Host half is the loaded one. */
  observe(id: string, disk: string | undefined): GateVerdict {
    const record = this.records.get(id)
    if (record === undefined || record.hostPath === undefined) return { action: 'apply' }
    record.disk = disk
    return record.loaded === disk ? { action: 'apply' } : { action: 'defer', reason: 'host-artifact-changed' }
  }

  /**
   * The Host replaced one or more packages in-process: those packages may apply
   * now. Returns the ids whose deferral is released.
   */
  release(filenames: readonly string[]): readonly string[] {
    const released: string[] = []
    for (const record of this.records.values()) {
      if (record.hostPath === undefined) continue
      if (!filenames.includes(record.hostPath)) continue
      record.loaded = record.disk
      released.push(record.id)
    }
    return released
  }

  deferred(): readonly string[] {
    const ids: string[] = []
    for (const record of this.records.values()) {
      if (record.hostPath === undefined) continue
      if (record.loaded === record.disk) continue
      ids.push(record.id)
    }
    return ids
  }

  facts(id: string): GateFacts | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    return { hostPath: record.hostPath, loaded: record.loaded, disk: record.disk }
  }
}
