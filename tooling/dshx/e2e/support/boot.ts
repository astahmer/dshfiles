import { type ChildProcess } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { prepareComposedBootProfile, type BootProfileBundle, type PreparedBootProfile } from '../../packages/dshx/src/project/boot-profile.js'
import { compositionFailures, readProfileComposition } from '../../packages/dshx/src/project/profile-composition.js'
import { spawnOwnedProcess, stopOwnedProcess } from '../../packages/dshx/src/project/owned-process.js'

const toolingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const workspaceRoot = resolve(toolingRoot, '..')
const pluginsRoot = join(workspaceRoot, 'plugins/@dshfiles')
const URL_PATTERN = /http:\/\/127\.0\.0\.1:\d+\/\S*/
const PackageManifest = z.object({ name: z.string().min(1), dsh: z.unknown().optional() }).passthrough()
const DshManifest = z.object({ client: z.record(z.string(), z.unknown()).optional() }).passthrough()

export interface LocalBootBundle extends BootProfileBundle {
  readonly hasClient: boolean
}

export interface BootedProfile {
  /** Tokenized URL held only for navigation inside the browser test. */
  readonly url: string
  readonly profile: string
  readonly port: number
  readonly expectedClientEntries: readonly string[]
  readonly host: ChildProcess
  /** Startup output with tokenized URLs removed. */
  output(): string
  close(): Promise<void>
}

const sanitizeOutput = (value: string): string => value.replaceAll(/http:\/\/127\.0\.0\.1:\d+\/\S*/g, '<private-url>')

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
    bundles.push({ projectRoot, packageId: manifest.name, hasClient: dsh.client !== undefined })
  }
  return bundles.sort((first, second) => first.packageId.localeCompare(second.packageId))
}

export const buildPlugin = async (projectRoot: string, packageId: string): Promise<void> => {
  const child = spawnOwnedProcess('pnpm', ['exec', 'dshx', 'build'], {
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
    if (status !== 0) throw new Error(`${packageId} build exited with code ${String(status)}:\n${sanitizeOutput(output)}`)
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

const waitForHostUrl = (host: ChildProcess, output: () => string, profile: string, timeoutMs: number): Promise<string> =>
  new Promise<string>((resolveUrl, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const match = URL_PATTERN.exec(output())
      if (match?.[0] !== undefined) {
        clearInterval(timer)
        host.off('exit', handleExit)
        resolveUrl(match[0])
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        host.off('exit', handleExit)
        reject(new Error(`the ${profile} scratch profile did not announce a URL within ${String(timeoutMs)}ms:\n${sanitizeOutput(output())}`))
      }
    }, 250)
    const handleExit = (code: number | null): void => {
      clearInterval(timer)
      reject(new Error(`${profile} scratch profile exited with code ${String(code)} before announcing a URL:\n${sanitizeOutput(output())}`))
    }
    host.once('exit', handleExit)
  })

export const startScratchProfile = async (
  prepared: PreparedBootProfile,
  profileLabel: string,
  expectedClientEntries: readonly string[],
  timeoutMs: number,
): Promise<BootedProfile> => {
  const dump = await readProfileComposition({
    projectRoot: workspaceRoot,
    profile: prepared.profile,
    profileRoot: prepared.profileRoot,
    dshHome: prepared.homeRoot,
    executable: 'dsh',
    timeoutMs,
  })
  const missingBundles = compositionFailures(dump, prepared.expectedBundles)
  if (missingBundles.length > 0) throw new Error(`The scratch profile did not compose expected bundles: ${missingBundles.join(', ')}.`)
  const port = await findFreePort()
  const host = spawnOwnedProcess('dsh', ['--profile', prepared.profile, '--port', String(port), '--no-open'], {
    cwd: workspaceRoot,
    env: { ...process.env, DSH_HOME: prepared.homeRoot, DSHX_BOOT_PROFILE_ROOT: prepared.profileRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-32_768)
  }
  host.stdout?.on('data', collect)
  host.stderr?.on('data', collect)
  try {
    const url = await waitForHostUrl(host, () => output, profileLabel, timeoutMs)
    let disposed = false
    return {
      url,
      profile: prepared.profile,
      port,
      expectedClientEntries,
      host,
      output: () => sanitizeOutput(output),
      async close(): Promise<void> {
        if (disposed) return
        disposed = true
        try {
          await stopOwnedProcess(host)
        } finally {
          await prepared.dispose()
        }
      },
    }
  } catch (error) {
    try {
      await stopOwnedProcess(host)
    } finally {
      await prepared.dispose()
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(sanitizeOutput(message))
  }
}

/** Boot a scratch composition of all owned bundles without touching the user's `web` profile. */
export const bootProfile = async (profileLabel: string, timeoutMs = 90_000): Promise<BootedProfile> => {
  const bundles = await listLocalBootBundles()
  if (bundles.length === 0) throw new Error('No owned plugin bundles were found for the composed scratch profile.')
  for (const bundle of bundles) await buildPlugin(bundle.projectRoot, bundle.packageId)
  const prepared = await prepareComposedBootProfile(bundles)
  const expectedClientEntries = bundles.filter(bundle => bundle.hasClient).map(bundle => bundle.packageId)
  try {
    return await startScratchProfile(prepared, profileLabel, expectedClientEntries, timeoutMs)
  } catch (error) {
    await prepared.dispose()
    throw error
  }
}
