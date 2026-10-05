import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { parse } from 'yaml'
import { CORDIS_IDENTITY_DEPENDENCIES } from 'create-dshx/capabilities'
import { spawnOwnedProcess, stopOwnedProcess } from './owned-process.js'

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../')
const PROFILE_NAME = 'dshx-boot'
const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const
const ProfilePackage = z
  .object({
    dependencies: z.record(z.string(), z.string()).default({}),
    dsh: z.object({ profile: z.object({ bundles: z.array(z.string()).default([]) }).passthrough() }).passthrough(),
  })
  .passthrough()
const WorkspacePackage = z.object({ packageManager: z.string() }).passthrough()
const ProjectPackage = z.object({ dsh: z.unknown() }).passthrough()
const PnpmModules = z.object({ packageManager: z.string(), storeDir: z.string().min(1) }).passthrough()
const SHARED_CORDIS_PACKAGES = Object.keys(CORDIS_IDENTITY_DEPENDENCIES)

export interface PreparedBootProfile {
  readonly homeRoot: string
  readonly profileRoot: string
  readonly profile: string
  readonly expectedBundles: readonly [string, ...string[]]
  dispose(): Promise<void>
}

export interface BootProfileBundle {
  readonly projectRoot: string
  readonly packageId: string
}

const runPnpm = async (profileRoot: string, homeRoot: string, args: readonly string[], timeoutMs: number): Promise<string> => {
  const environment: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: homeRoot }
  delete environment.FORCE_COLOR
  const child = spawnOwnedProcess('pnpm', args, {
    cwd: profileRoot,
    env: environment,
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
        reject(new Error(`pnpm ${args[0] ?? 'command'} exceeded ${String(timeoutMs)}ms.`))
      }, timeoutMs)
      child.once('error', handleError)
      child.once('close', handleClose)
    })
    if (status !== 0) throw new Error(`pnpm ${args[0] ?? 'command'} exited with code ${String(status)}.`)
    return output.trim()
  } finally {
    await stopOwnedProcess(child)
  }
}

const pnpmPeerIdentity = (resolvedPath: string): string => resolvedPath.split(`${sep}.pnpm${sep}`)[1] ?? resolvedPath

const assertSharedCordisIdentity = (projectRoot: string): void => {
  const projectRequire = createRequire(join(projectRoot, 'package.json'))
  const sdkRequire = createRequire(join(WORKSPACE_ROOT, 'tooling/dshx/packages/dshx/package.json'))
  for (const packageName of SHARED_CORDIS_PACKAGES) {
    let projectIdentity: string
    let sdkIdentity: string
    try {
      projectIdentity = pnpmPeerIdentity(projectRequire.resolve(packageName))
      sdkIdentity = pnpmPeerIdentity(sdkRequire.resolve(packageName))
    } catch (error) {
      throw new Error(`Boot checks cannot verify shared ${packageName} identity: ${error instanceof Error ? error.message : String(error)}.`)
    }
    if (projectIdentity !== sdkIdentity) {
      throw new Error(
        `Boot checks found different ${packageName} peer identities for the plugin and DSHX SDK. Align cordis, cordis-plugin-include, and cordis-plugin-loader with the repository workspace overrides before booting.`,
      )
    }
  }
}

const installProfile = async (profileRoot: string, homeRoot: string, expectedPackageManager: string): Promise<void> => {
  const actualPackageManager = await runPnpm(profileRoot, homeRoot, ['--version'], 30_000)
  const expectedVersion = /^pnpm@(.+)$/.exec(expectedPackageManager)?.[1]
  if (expectedVersion === undefined || actualPackageManager !== expectedVersion) {
    throw new Error(`Boot profile requires ${expectedPackageManager}; pnpm resolved ${actualPackageManager || 'an unknown version'}.`)
  }
  await runPnpm(profileRoot, homeRoot, ['install', '--prefer-offline'], 180_000)
  const modulesSource = await readFile(join(profileRoot, 'node_modules/.modules.yaml'), 'utf8')
  const modules = PnpmModules.parse(parse(modulesSource))
  if (modules.packageManager !== expectedPackageManager) {
    throw new Error(`Boot profile store metadata uses ${modules.packageManager}; expected ${expectedPackageManager}.`)
  }
}

const prepareBootProfiles = async (localBundles: readonly [BootProfileBundle, ...BootProfileBundle[]]): Promise<PreparedBootProfile> => {
  const sourceHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const sourceProfileRoot = join(sourceHome, 'profiles', 'web')
  const sourceManifest = ProfilePackage.parse(JSON.parse(await readFile(join(sourceProfileRoot, 'package.json'), 'utf8')))
  const pnpmWorkspace = await readFile(join(sourceProfileRoot, 'pnpm-workspace.yaml'))
  const workspaceManifest = WorkspacePackage.parse(JSON.parse(await readFile(join(WORKSPACE_ROOT, 'tooling/dshx/package.json'), 'utf8')))
  const pinnedNode = (await readFile(join(WORKSPACE_ROOT, '.node-version'), 'utf8')).trim()
  if (pinnedNode !== '' && process.versions.node !== pinnedNode) {
    throw new Error(`Boot checks require repository Node ${pinnedNode}; current Node is ${process.versions.node}.`)
  }
  for (const bundle of localBundles) {
    const projectManifest = ProjectPackage.parse(JSON.parse(await readFile(join(bundle.projectRoot, 'package.json'), 'utf8')))
    if (typeof projectManifest.dsh !== 'object' || projectManifest.dsh === null || Array.isArray(projectManifest.dsh)) {
      throw new Error(`Cannot prepare a DSH boot profile for ${bundle.packageId}: package.json has no dsh bundle metadata.`)
    }
    assertSharedCordisIdentity(bundle.projectRoot)
  }

  const [firstBundle, ...remainingBundles] = localBundles
  const packageIds: [string, ...string[]] = [firstBundle.packageId, ...remainingBundles.map(bundle => bundle.packageId)]
  if (new Set(packageIds).size !== packageIds.length) throw new Error('A scratch profile cannot contain duplicate local bundle ids.')

  const homeRoot = await mkdtemp(join(tmpdir(), 'dshx-boot-profile-'))
  const profileRoot = join(homeRoot, 'profiles', PROFILE_NAME)
  let disposed = false
  try {
    await mkdir(profileRoot, { recursive: true })
    const dependencies = Object.fromEntries(Object.entries(sourceManifest.dependencies).filter(([name]) => !name.startsWith('@dshfiles/')))
    const bundles = [...new Set([...BASE_BUNDLES, ...packageIds])]
    for (const bundle of localBundles) dependencies[bundle.packageId] = `link:${resolve(bundle.projectRoot)}`
    const manifest = {
      name: 'dshx-boot-profile',
      version: '0.0.0',
      private: true,
      type: 'module',
      packageManager: workspaceManifest.packageManager,
      dependencies,
      dsh: { profile: { bundles } },
    }
    await writeFile(join(profileRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(join(profileRoot, 'pnpm-workspace.yaml'), pnpmWorkspace)
    await installProfile(profileRoot, homeRoot, workspaceManifest.packageManager)
    return {
      homeRoot,
      profileRoot,
      profile: PROFILE_NAME,
      expectedBundles: packageIds,
      async dispose() {
        if (disposed) return
        disposed = true
        await rm(homeRoot, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await rm(homeRoot, { recursive: true, force: true })
    throw error
  }
}

export const prepareBootProfile = async (projectRoot: string, packageId: string): Promise<PreparedBootProfile> =>
  prepareBootProfiles([{ projectRoot, packageId }])

export const prepareComposedBootProfile = async (localBundles: readonly [BootProfileBundle, ...BootProfileBundle[]]): Promise<PreparedBootProfile> =>
  prepareBootProfiles(localBundles)
