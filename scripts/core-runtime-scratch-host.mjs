import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const profileName = process.env.DSHX_BOOT_PROFILE_NAME
const profileRoot = process.env.DSHX_BOOT_PROFILE_ROOT
const home = process.env.DSH_HOME
if (profileName === undefined || profileRoot === undefined || home === undefined)
  throw new Error('Scratch Host requires DSHX_BOOT_PROFILE_NAME, DSHX_BOOT_PROFILE_ROOT, and DSH_HOME.')

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
const appBoot = await import(pathToFileURL(appBootPath).href)
const profile = appBoot.loadProfile('dsh', profileName, dshPackagePath, home)
const { runProfile } = await import(pathToFileURL(profileBootPath).href)
const environment = { get: () => undefined, getFrom: () => undefined }

await runProfile({
  environment,
  profile: profileName,
  resolvedProfile: { profile, installAnchor: resolve(profileRoot, 'package.json') },
  patchFiles: [],
  args: ['--port', '0', '--no-open'],
})

await new Promise(() => undefined)
