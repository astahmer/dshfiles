import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { decodeJson, jsonValueSchema } from '../json.js'
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
const ClientExternals = z
  .object({ dsh: z.object({ client: z.object({ external: z.array(z.string()).default([]) }).passthrough().optional() }).passthrough() })
  .passthrough()
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

/** A virtual store inside the repository but outside its root is a per-folder install from before the unified workspace. */
const staleNestedInstallRoot = (resolvedPath: string): string | undefined => {
  const storeIndex = resolvedPath.indexOf(`${sep}node_modules${sep}.pnpm${sep}`)
  if (storeIndex === -1) return undefined
  const installRoot = resolvedPath.slice(0, storeIndex)
  const fromWorkspace = relative(WORKSPACE_ROOT, installRoot)
  const insideWorkspace = fromWorkspace !== '' && !fromWorkspace.startsWith('..') && !fromWorkspace.startsWith(sep)
  return insideWorkspace ? installRoot : undefined
}

const assertSharedCordisIdentity = (projectRoot: string): void => {
  const projectRequire = createRequire(join(projectRoot, 'package.json'))
  const sdkRequire = createRequire(join(WORKSPACE_ROOT, 'tooling/dshx/packages/dshx/package.json'))
  for (const packageName of SHARED_CORDIS_PACKAGES) {
    let projectPath: string
    let sdkPath: string
    try {
      projectPath = projectRequire.resolve(packageName)
      sdkPath = sdkRequire.resolve(packageName)
    } catch (error) {
      throw new Error(`Boot checks cannot verify shared ${packageName} identity: ${error instanceof Error ? error.message : String(error)}.`)
    }
    const staleRoots = [...new Set([projectPath, sdkPath].flatMap(path => staleNestedInstallRoot(path) ?? []))]
    if (staleRoots.length > 0) {
      const folders = staleRoots.map(root => join(relative(WORKSPACE_ROOT, root), 'node_modules')).join(', ')
      throw new Error(
        `Boot checks resolved ${packageName} from a stale nested install (${folders}) left from before the unified workspace, which gives Cordis a second identity. Remove ${folders} and run "pnpm install" at the repository root.`,
      )
    }
    const projectIdentity = pnpmPeerIdentity(projectPath)
    const sdkIdentity = pnpmPeerIdentity(sdkPath)
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

interface PrepareBootProfilesOptions {
  readonly additionalBundleIds?: readonly string[]
  readonly sourceProfileRoot?: string
  readonly includeSourceProfileBundles?: boolean
  /** The profile's own `cordis.patch.yml`, for Loader rows no bundle composes (e.g. the session-content index). */
  readonly cordisPatch?: string
}

const prepareBootProfiles = async (
  localBundles: readonly [BootProfileBundle, ...BootProfileBundle[]],
  options: PrepareBootProfilesOptions = {},
): Promise<PreparedBootProfile> => {
  const sourceHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const sourceProfileRoot = options.sourceProfileRoot ?? join(sourceHome, 'profiles', 'web')
  const sourceManifest = ProfilePackage.parse(decodeJson(jsonValueSchema, await readFile(join(sourceProfileRoot, 'package.json'), 'utf8')))
  const pnpmWorkspace = await readFile(join(sourceProfileRoot, 'pnpm-workspace.yaml'))
  const workspaceManifest = WorkspacePackage.parse(decodeJson(jsonValueSchema, await readFile(join(WORKSPACE_ROOT, 'tooling/dshx/package.json'), 'utf8')))
  const pinnedNode = (await readFile(join(WORKSPACE_ROOT, '.node-version'), 'utf8')).trim()
  if (pinnedNode !== '' && process.versions.node !== pinnedNode) {
    throw new Error(`Boot checks require repository Node ${pinnedNode}; current Node is ${process.versions.node}.`)
  }
  // A bundle that keeps an owned package external (shared-runtime) cannot load without it, so its provider joins the profile.
  const composedBundles: [BootProfileBundle, ...BootProfileBundle[]] = [...localBundles]
  for (const bundle of composedBundles) {
    const projectManifest = ProjectPackage.parse(decodeJson(jsonValueSchema, await readFile(join(bundle.projectRoot, 'package.json'), 'utf8')))
    if (typeof projectManifest.dsh !== 'object' || projectManifest.dsh === null || Array.isArray(projectManifest.dsh)) {
      throw new Error(`Cannot prepare a DSH boot profile for ${bundle.packageId}: package.json has no dsh bundle metadata.`)
    }
    assertSharedCordisIdentity(bundle.projectRoot)
    for (const external of ClientExternals.parse(projectManifest).dsh.client?.external ?? []) {
      const providerRoot = join(WORKSPACE_ROOT, 'plugins', external)
      if (!external.startsWith('@dshfiles/') || composedBundles.some(composed => composed.packageId === external)) continue
      if (!existsSync(join(providerRoot, 'package.json'))) continue
      composedBundles.push({ projectRoot: providerRoot, packageId: external })
    }
  }

  const [firstBundle, ...remainingBundles] = composedBundles
  const packageIds: [string, ...string[]] = [firstBundle.packageId, ...remainingBundles.map(bundle => bundle.packageId)]
  const additionalBundleIds = options.additionalBundleIds ?? []
  const expectedBundles: [string, ...string[]] = [packageIds[0], ...packageIds.slice(1), ...additionalBundleIds]
  if (new Set(expectedBundles).size !== expectedBundles.length) throw new Error('A scratch profile cannot contain duplicate bundle ids.')

  const homeRoot = await mkdtemp(join(tmpdir(), 'dshx-boot-profile-'))
  const profileRoot = join(homeRoot, 'profiles', PROFILE_NAME)
  let disposed = false
  try {
    await mkdir(profileRoot, { recursive: true })
    const dependencies = Object.fromEntries(Object.entries(sourceManifest.dependencies).filter(([name]) => !name.startsWith('@dshfiles/')))
    const localPackageIds = new Set(packageIds)
    const profileBundles = sourceManifest.dsh.profile.bundles.filter(bundleId => bundleId.startsWith('@dshfiles/'))
    if (options.includeSourceProfileBundles === true) {
      const missingLocalBundles = profileBundles.filter(bundleId => !localPackageIds.has(bundleId))
      if (missingLocalBundles.length > 0) {
        throw new Error(`The composed web boot is missing source bundles: ${missingLocalBundles.join(', ')}.`)
      }
    }
    const bundles =
      options.includeSourceProfileBundles === true ? [...new Set(sourceManifest.dsh.profile.bundles)] : [...new Set([...BASE_BUNDLES, ...expectedBundles])]
    for (const bundle of composedBundles) dependencies[bundle.packageId] = `link:${resolve(bundle.projectRoot)}`
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
    if (options.cordisPatch !== undefined) await writeFile(join(profileRoot, 'cordis.patch.yml'), options.cordisPatch)
    await installProfile(profileRoot, homeRoot, workspaceManifest.packageManager)
    return {
      homeRoot,
      profileRoot,
      profile: PROFILE_NAME,
      expectedBundles: options.includeSourceProfileBundles === true ? [bundles[0] ?? BASE_BUNDLES[0], ...bundles.slice(1)] : expectedBundles,
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

export const prepareComposedBootProfile = async (
  localBundles: readonly [BootProfileBundle, ...BootProfileBundle[]],
  options: PrepareBootProfilesOptions = {},
): Promise<PreparedBootProfile> => prepareBootProfiles(localBundles, options)
