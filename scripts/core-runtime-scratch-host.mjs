import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
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
const resolution = await appBoot.createRuntimeResolution({ installAnchor: dshPackagePath, profile, home })
if (process.env.DSHX_SCRATCH_TRACE_IMPORT_ERRORS === '1') {
  const sessionEntries = resolution.entries.filter(entry => entry.name === '@deepseek-ai/dsh-session')
  const sessionLinks = resolution.linkedRoots.filter(root => root.name === '@deepseek-ai/dsh-session')
  process.stderr.write(
    `Scratch dsh-session resolution inputs: ${JSON.stringify({
      localPackage: resolution.localPackageNames.includes('@deepseek-ai/dsh-session'),
      entries: sessionEntries.map(({ name, scope, packageDir }) => ({ name, scope, packageDir })),
      linkedRoots: sessionLinks,
    })}\n`,
  )
}
const scopeEntry = resolution.entries.find(entry => entry.name === '@deepseek-ai/dsh-scope')
if (scopeEntry === undefined || scopeEntry.scope !== 'installation' || scopeEntry.packageDir.startsWith(repoRoot))
  throw new Error('Scratch Host did not resolve dsh-scope from the DSH installation.')
console.log('Scratch Host dsh-scope resolves from the DSH installation.')
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
  resolvedProfile: { profile, installAnchor: dshPackagePath },
  patchFiles: patchFile === undefined ? [] : [patchFile],
  args: ['--port', '0', '--no-open'],
})

await new Promise(() => undefined)
