import { type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { prepareComposedBootProfile, type PreparedBootProfile } from '../../packages/dshx/src/project/boot-profile.js'
import { DSHFILES_ROOT, buildPlugin, findFreePort, listLocalBootBundles, resolveLocalBundles, withSharedStylesheet } from '../../packages/dshx/src/project/local-bundles.js'
import { compositionFailures, readProfileComposition } from '../../packages/dshx/src/project/profile-composition.js'
import { spawnOwnedProcess, stopOwnedProcess } from '../../packages/dshx/src/project/owned-process.js'
import { isolatedHostEnvironment, redactHostOutput } from './scratch-profile.js'

const workspaceRoot = DSHFILES_ROOT
// Registry dependencies come from the checked-in seed, not the live ~/.dsh profile, so a journey (and its cached
// Turbo result) depends only on the repository.
const sourceProfileRoot = join(workspaceRoot, 'profiles/web')
const URL_PATTERN = /http:\/\/127\.0\.0\.1:\d+\/\S*/

export interface BootedProfile {
  /** Tokenized URL held only for navigation inside the browser test. */
  readonly url: string
  readonly profile: string
  readonly homeRoot: string
  readonly port: number
  readonly expectedClientEntries: readonly string[]
  readonly host: ChildProcess
  /** Startup output with tokenized URLs removed. */
  output(): string
  close(): Promise<void>
}

const sanitizeOutput = redactHostOutput

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
    // directory-picker-auto mounts the OS chooser on a darwin/win32 loopback Host, which a browser cannot drive; an SSH
    // launch is its documented signal for the in-app browse picker, so folder journeys behave the same on every platform.
    env: { ...isolatedHostEnvironment(prepared.homeRoot, prepared.profileRoot), SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0' },
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
      homeRoot: prepared.homeRoot,
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

// A bundle's sources do not change during a run, so each worker builds it once instead of once per scenario; `pnpm
// check:e2e` builds every bundle up front and sets DSHX_E2E_PREBUILT=1 to skip even that.
const builtBundles = new Set<string>()

const buildBundleOnce = async (bundle: { readonly projectRoot: string; readonly packageId: string }): Promise<void> => {
  if (process.env.DSHX_E2E_PREBUILT === '1' || builtBundles.has(bundle.packageId)) return
  await buildPlugin(bundle.projectRoot, bundle.packageId)
  builtBundles.add(bundle.packageId)
}

/** Boot a scratch composition of all owned bundles without touching the user's `web` profile. */
export const bootProfile = async (profileLabel: string, timeoutMs = 90_000): Promise<BootedProfile> => {
  const bundles = await listLocalBootBundles()
  if (bundles.length === 0) throw new Error('No owned plugin bundles were found for the composed scratch profile.')
  for (const bundle of bundles) await buildBundleOnce(bundle)
  const prepared = await prepareComposedBootProfile(bundles, { sourceProfileRoot })
  const expectedClientEntries = bundles.filter(bundle => bundle.hasClient).map(bundle => bundle.packageId)
  try {
    return await startScratchProfile(prepared, profileLabel, expectedClientEntries, timeoutMs)
  } catch (error) {
    await prepared.dispose()
    throw error
  }
}

export const bootComposedPluginProfile = async ({
  packageIds,
  profileLabel,
  timeoutMs = 90_000,
  additionalBundleIds = [],
  seedHome,
  cordisPatch,
}: {
  readonly packageIds: readonly [string, ...string[]]
  readonly profileLabel: string
  readonly timeoutMs?: number
  readonly additionalBundleIds?: readonly string[]
  readonly seedHome?: (homeRoot: string) => Promise<void>
  readonly cordisPatch?: string
}): Promise<BootedProfile> => {
  const available = await listLocalBootBundles()
  const bundles = withSharedStylesheet(resolveLocalBundles(packageIds, available), available)
  for (const bundle of bundles) await buildBundleOnce(bundle)
  const prepared = await prepareComposedBootProfile(
    bundles,
    cordisPatch === undefined ? { additionalBundleIds, sourceProfileRoot } : { additionalBundleIds, sourceProfileRoot, cordisPatch },
  )
  const expectedClientEntries = bundles.filter(bundle => bundle.hasClient).map(bundle => bundle.packageId)
  try {
    await seedHome?.(prepared.homeRoot)
    return await startScratchProfile(prepared, profileLabel, expectedClientEntries, timeoutMs)
  } catch (error) {
    await prepared.dispose()
    throw error
  }
}

export const bootPluginProfile = async (packageId: string, timeoutMs = 90_000): Promise<BootedProfile> =>
  bootComposedPluginProfile({ packageIds: [packageId], profileLabel: packageId, timeoutMs })
