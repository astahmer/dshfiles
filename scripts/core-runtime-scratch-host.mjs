import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profileName = process.env.DSHX_BOOT_PROFILE_NAME
const home = process.env.DSH_HOME
const patchFile = process.env.DSHX_BOOT_PATCH_FILE
if (profileName === undefined || home === undefined)
  throw new Error('Scratch Host requires DSHX_BOOT_PROFILE_NAME and DSH_HOME.')

const dshShimPath = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
const dshShim = readFileSync(dshShimPath, 'utf8')
const dshBinReference = dshShim.match(/global\/v\d+\/[a-f0-9]+\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js/)?.[0]
if (dshBinReference === undefined) throw new Error('Could not locate the installed DSH package through its pnpm command shim.')

const dshBinPath = realpathSync(resolve(dirname(dshShimPath), '..', dshBinReference))
const dshPackageRoot = dirname(dirname(dshBinPath))
const dshPackagePath = resolve(dshPackageRoot, 'package.json')
const dshPackage = JSON.parse(readFileSync(dshPackagePath, 'utf8'))
if (dshPackage.version !== '0.2.0-rc.2') throw new Error(`Scratch Host requires DSH 0.2.0-rc.2; found ${String(dshPackage.version)}.`)

const dshRequire = createRequire(dshPackagePath)
const appBootPackagePath = dshRequire.resolve('@deepseek-ai/dsh-app-boot/package.json')
const appBootPackageRoot = dirname(appBootPackagePath)
const appBootPath = resolve(appBootPackageRoot, 'lib/index.js')
const profileBootPath = resolve(dshPackageRoot, 'lib/profile-boot.js')

const createScratchInstallationAnchor = installedResolution => {
  const installationRoot = resolve(home, '.dshx-scratch-installation')
  const nodeModulesRoot = resolve(installationRoot, 'node_modules')
  const anchorPath = resolve(installationRoot, 'package.json')
  const coreRoot = resolve(repoRoot, 'tooling/dsh-core')
  const installationEntries = installedResolution.entries.filter(entry => entry.scope === 'installation')
  const packageTargets = new Map(installationEntries.map(entry => [entry.name, entry.packageDir]))
  const localCorePackages = installedResolution.linkedRoots
    .filter(root => root.name.startsWith('@deepseek-ai/dsh-') && root.realPath.startsWith(`${coreRoot}/`))
    .map(root => [root.name, root.realPath])
  for (const [name, path] of localCorePackages) packageTargets.set(name, path)
  if (!localCorePackages.some(([name]) => name === '@deepseek-ai/dsh-session')) {
    throw new Error('Scratch profile did not link the local dsh-session core package.')
  }
  const dependencies = Object.fromEntries([...packageTargets.keys()].map(name => [name, '*']))
  mkdirSync(nodeModulesRoot, { recursive: true })

  for (const [name, packageDirectory] of packageTargets) {
    const packagePath = resolve(nodeModulesRoot, name)
    mkdirSync(dirname(packagePath), { recursive: true })
    const targetPath = realpathSync(packageDirectory)
    try {
      const existingTargetPath = realpathSync(packagePath)
      if (existingTargetPath !== targetPath) {
        throw new Error(`Scratch installation link for ${name} points to an unexpected package.`)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      symlinkSync(targetPath, packagePath, 'dir')
    }
  }

  writeFileSync(anchorPath, `${JSON.stringify({
    name: '@dshx/scratch-installation',
    version: '0.0.0',
    dependencies,
  }, null, 2)}\n`)
  return { anchorPath, localCorePackages }
}

if (process.env.DSHX_SCRATCH_TRACE_IMPORT_ERRORS === '1') {
  const internalLoader = dshRequire('node-addon-require-builtin')
    .requireBuiltin('internal/modules/esm/loader')
    .getOrInitializeCascadedLoader()
  const importModule = internalLoader.import
  const resolveModule = internalLoader.resolve
  internalLoader.resolve = async function (specifier, parentUrl, options) {
    const resolution = await resolveModule.call(this, specifier, parentUrl, options)
    if (
      specifier === '@deepseek-ai/dsh-session' &&
      String(parentUrl).includes('/dsh-api-session-controller/')
    ) {
      process.stderr.write(`Session Controller dsh-session resolution: ${resolution.url}\n`)
    }
    return resolution
  }
  internalLoader.import = async function (specifier, parentUrl, options) {
    try {
      return await importModule.call(this, specifier, parentUrl, options)
    } catch (error) {
      if (
        specifier === '@deepseek-ai/dsh-api-session-controller' ||
        String(parentUrl).includes('/dsh-api-session-controller/')
      ) {
        process.stderr.write(
          `Session Controller import failure from ${String(parentUrl)}: ${error.stack ?? error}\n`,
        )
      }
      throw error
    }
  }
}

const appBoot = await import(pathToFileURL(appBootPath).href)
const profile = appBoot.loadProfile('dsh', profileName, dshPackagePath, home)
if (resolve(profile.dir) !== resolve(profileRoot)) throw new Error('Scratch profile resolution loaded a different profile directory.')
const installedResolution = await appBoot.createRuntimeResolution({ installAnchor: dshPackagePath, profile, home })
const { anchorPath: installAnchor, localCorePackages } = createScratchInstallationAnchor(installedResolution)
const resolution = await appBoot.createRuntimeResolution({ installAnchor, profile, home })
if (process.env.DSHX_SCRATCH_TRACE_IMPORT_ERRORS === '1') {
  const sessionEntries = resolution.entries.filter(entry => entry.name === '@deepseek-ai/dsh-session')
  const sessionLinks = resolution.linkedRoots.filter(root => root.name === '@deepseek-ai/dsh-session')
  process.stderr.write(
    `Scratch dsh-session resolution inputs: ${JSON.stringify({
      localPackage: resolution.localPackageNames.includes('@deepseek-ai/dsh-session'),
      entries: sessionEntries.map(({ name, scope, packageDir }) => ({ name, scope, packageDir })),
      linkedRoots: sessionLinks,
      localCorePackages,
    })}\n`,
  )
}
const scopeEntry = resolution.entries.find(entry => entry.name === '@deepseek-ai/dsh-scope')
if (scopeEntry === undefined || scopeEntry.scope !== 'installation' || scopeEntry.packageDir.startsWith(repoRoot))
  throw new Error('Scratch Host did not resolve dsh-scope from the DSH installation.')
console.log('Scratch Host dsh-scope resolves from the DSH installation.')
const sessionEntry = resolution.entries.find(entry => entry.name === '@deepseek-ai/dsh-session')
if (
  sessionEntry === undefined ||
  realpathSync(sessionEntry.packageDir) !== realpathSync(resolve(repoRoot, 'tooling/dsh-core/session'))
) {
  throw new Error('Scratch Host did not resolve dsh-session from the local core source package.')
}
for (const [name, localPath] of localCorePackages) {
  const entry = resolution.entries.find(candidate => candidate.name === name)
  if (entry === undefined || realpathSync(entry.packageDir) !== realpathSync(localPath)) {
    throw new Error(`Scratch Host did not resolve ${name} from its local core source package.`)
  }
}
console.log(`Scratch Host resolves local core packages: ${localCorePackages.map(([name]) => name).join(', ')}.`)
const { runProfile } = await import(pathToFileURL(profileBootPath).href)
const syntheticCursorCredential = process.env.DSHX_SCRATCH_CURSOR_CREDENTIAL
const launchEnvironmentEntry = name => {
  if (name !== 'CURSOR_API_KEY' || syntheticCursorCredential !== 'scratch-only-cursor-fixture') return undefined
  return { value: syntheticCursorCredential, source: 'process' }
}
const environment = {
  get: launchEnvironmentEntry,
  getFrom: (name, sources) => sources.includes('process') ? launchEnvironmentEntry(name) : undefined,
}

await runProfile({
  environment,
  profile: profileName,
  resolvedProfile: { profile, installAnchor },
  patchFiles: patchFile === undefined ? [] : [patchFile],
  args: ['--port', '0', '--no-open'],
})

await new Promise(() => undefined)
