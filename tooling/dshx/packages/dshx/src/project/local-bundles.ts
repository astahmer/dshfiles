import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { BootProfileBundle } from './boot-profile.js'
import { spawnOwnedProcess, stopOwnedProcess } from './owned-process.js'
import { redactHostOutput } from './scratch-profile.js'

/** The dshfiles checkout this package was built in; the same depth from `src/project` and `dist/project`. */
export const DSHFILES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../')
const pluginsRoot = join(DSHFILES_ROOT, 'plugins/@dshfiles')

const PackageManifest = z.object({ name: z.string().min(1), dsh: z.unknown().optional() }).passthrough()
const DshManifest = z
  .object({
    client: z
      .object({ external: z.array(z.string()).default([]) })
      .passthrough()
      .optional(),
  })
  .passthrough()

export interface LocalBootBundle extends BootProfileBundle {
  readonly hasClient: boolean
  readonly clientExternalPackages: readonly string[]
}

/** Owned Cordis bundles under plugins/@dshfiles, sorted by package id. */
export const listLocalBootBundles = async (): Promise<LocalBootBundle[]> => {
  const entries = await readdir(pluginsRoot, { withFileTypes: true })
  const bundles: LocalBootBundle[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectRoot = join(pluginsRoot, entry.name)
    const source = await readFile(join(projectRoot, 'package.json'), 'utf8').catch(() => undefined)
    if (source === undefined) continue
    let rawManifest: unknown
    try {
      rawManifest = JSON.parse(source)
    } catch (error) {
      throw new Error(`Cannot read ${join(projectRoot, 'package.json')}: ${error instanceof Error ? error.message : String(error)}.`)
    }
    const manifest = PackageManifest.parse(rawManifest)
    if (manifest.dsh === undefined) continue
    const dsh = DshManifest.parse(manifest.dsh)
    bundles.push({
      projectRoot,
      packageId: manifest.name,
      hasClient: dsh.client !== undefined,
      clientExternalPackages: dsh.client?.external ?? [],
    })
  }
  return bundles.sort((first, second) => first.packageId.localeCompare(second.packageId))
}

/** The requested bundles plus the owned client bundles they load as externals, dependencies first. */
export const resolveLocalBundles = (packageIds: readonly string[], available: readonly LocalBootBundle[]): LocalBootBundle[] => {
  const ordered = new Map<string, LocalBootBundle>()
  const visiting = new Set<string>()
  const visit = (bundle: LocalBootBundle): void => {
    if (ordered.has(bundle.packageId)) return
    if (visiting.has(bundle.packageId)) throw new Error(`Local client bundle dependency cycle includes ${bundle.packageId}.`)
    visiting.add(bundle.packageId)
    for (const packageId of bundle.clientExternalPackages) {
      const dependency = available.find(candidate => candidate.packageId === packageId)
      if (dependency !== undefined) visit(dependency)
    }
    visiting.delete(bundle.packageId)
    ordered.set(bundle.packageId, bundle)
  }
  for (const packageId of packageIds) {
    const bundle = available.find(candidate => candidate.packageId === packageId)
    if (bundle === undefined) throw new Error(`Owned plugin bundle ${packageId} was not found under plugins/@dshfiles.`)
    visit(bundle)
  }
  return [...ordered.values()]
}

export const buildPlugin = async (projectRoot: string, packageId: string): Promise<void> => {
  const child = spawnOwnedProcess('pnpm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-8_192)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  try {
    const status = await new Promise<number | null>((resolveStatus, reject) => {
      let settled = false
      const finish = (code: number | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.off('error', handleError)
        child.off('close', handleClose)
        resolveStatus(code)
      }
      const handleError = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
      const handleClose = (code: number | null): void => finish(code)
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.off('error', handleError)
        child.off('close', handleClose)
        reject(new Error(`${packageId} build exceeded 180000ms.`))
      }, 180_000)
      child.once('error', handleError)
      child.once('close', handleClose)
    })
    if (status !== 0) throw new Error(`${packageId} build exited with code ${String(status)}:\n${redactHostOutput(output)}`)
  } finally {
    await stopOwnedProcess(child)
  }
}

/** Reserve a port by binding it and letting go, so the Host can take it. */
export const findFreePort = async (): Promise<number> =>
  new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('could not reserve a port'))
        return
      }
      const { port } = address
      server.close(() => resolvePort(port))
    })
  })
