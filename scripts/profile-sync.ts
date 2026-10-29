import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { decodeJson } from './json.ts'

/**
 * Link owned bundles into a DSH profile and install it. The single reconciler for profiles: `pnpm profile:sync`, the
 * nixfiles activation, the `dsh web` supervisor (before every start) and `dshx checkout sync` all run this file.
 *
 * `pnpm add <path>` cannot express a local bundle (see AGENTS.md), so this declares `link:` dependencies and the bundle
 * list in the profile manifest, then runs `pnpm install` there.
 *
 * A profile with a seed (`profiles/<name>/`) is reconciled from it: missing seed files are copied in, the seed's
 * dependencies (relative links resolved against the seed folder) and bundles are applied, entries a previous sync
 * managed and the seed dropped are removed unless the user changed them, `@dshfiles/*` rows are exactly the seed's, the
 * marked Cordis region is restored, and `pnpm install` runs only when the manifest differs from the last installed one.
 * Every other entry is the user's and stays. Without a seed the profile gets every owned bundle; `--bundle` adds or
 * refreshes the named bundles and leaves the other rows alone. Writes happen under DSH's `package.json.lock` and are
 * atomic.
 */

const repositoryRoot = join(import.meta.dirname, '..')
const packagesRoot = join(repositoryRoot, 'plugins/@dshfiles')
const lockWaitMs = 120_000
const installTimeoutMs = 180_000
const stateFilename = '.dshfiles-profile-sync.json'
const legacyStateFilename = '.nixfiles-managed-plugins.json'
const patchStart = '# BEGIN NIX-MANAGED DSH PLUGINS'
const patchEnd = '# END NIX-MANAGED DSH PLUGINS'
const seededFiles = ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']

const profileManifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).default({}),
  dsh: z.looseObject({ profile: z.looseObject({ bundles: z.array(z.string()).default([]) }).default({ bundles: [] }) }).default({ profile: { bundles: [] } }),
})
const seedManifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).default({}),
  dsh: z.looseObject({ profile: z.looseObject({ bundles: z.array(z.string()) }) }),
})
const syncStateSchema = z.object({
  dependencies: z.record(z.string(), z.string()),
  bundles: z.array(z.string()),
  installedManifestHash: z.string().optional(),
})
type SyncState = z.infer<typeof syncStateSchema>

const readJson = <Schema extends z.ZodType>(schema: Schema, path: string): z.output<Schema> => decodeJson(schema, readFileSync(path, 'utf8'))
const errorCode = (error: unknown): string | undefined => z.object({ code: z.string() }).safeParse(error).data?.code
const isOwned = (name: string): boolean => name.startsWith('@dshfiles/')
const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')
const log = (message: string): void => console.log(`profile-sync: ${message}`)

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'probe' },
    home: { type: 'string' },
    seed: { type: 'string' },
    bundle: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean', default: false },
  },
})
const dshHome = resolve(values.home ?? (process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')))
const profileDirectory = join(dshHome, 'profiles', values.profile)
const manifestPath = join(profileDirectory, 'package.json')
const seedDirectory = resolve(values.seed ?? join(repositoryRoot, 'profiles', values.profile))
const seedManifestPath = join(seedDirectory, 'package.json')
const dryRun = values['dry-run']

const holderExited = (record: string): boolean => {
  const processId = Number.parseInt(record.split('\n')[0] ?? '', 10)
  if (!Number.isInteger(processId)) return false
  try {
    process.kill(processId, 0)
    return false
  } catch (error) {
    return errorCode(error) === 'ESRCH'
  }
}

const readLockRecord = (lockPath: string): string | undefined => {
  try {
    return readFileSync(lockPath, 'utf8')
  } catch {
    return undefined
  }
}

/** Same protocol as DSH's `@deepseek-ai/dsh-atomic-write`: a `wx` sibling holding the PID, taken over once that PID is gone. */
const takeOverExitedLock = (lockPath: string): boolean => {
  const record = readLockRecord(lockPath)
  if (record === undefined || !holderExited(record)) return false
  const claimPath = `${lockPath}.takeover-${sha256(record).slice(0, 16)}`
  let claimDescriptor: number
  try {
    claimDescriptor = openSync(claimPath, 'wx', 0o600)
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false
    throw error
  }
  try {
    writeSync(claimDescriptor, `${process.pid}\n`)
    closeSync(claimDescriptor)
    if (readLockRecord(lockPath) !== record || !holderExited(record)) return false
    rmSync(lockPath, { force: true })
    return true
  } finally {
    rmSync(claimPath, { force: true })
  }
}

const withProfileLock = async <T>(work: () => Promise<T>): Promise<T> => {
  const lockPath = `${manifestPath}.lock`
  const deadline = Date.now() + lockWaitMs
  let delayMs = 20
  while (true) {
    let lockDescriptor: number
    try {
      lockDescriptor = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      if (takeOverExitedLock(lockPath)) continue
      if (Date.now() >= deadline) throw new Error(`timed out waiting for the DSH profile lock ${lockPath}`)
      await sleep(delayMs)
      delayMs = Math.min(delayMs * 2, 200)
      continue
    }
    try {
      writeSync(lockDescriptor, `${process.pid}\n`)
      closeSync(lockDescriptor)
    } catch (error) {
      rmSync(lockPath, { force: true })
      throw error
    }
    break
  }
  try {
    return await work()
  } finally {
    rmSync(lockPath, { force: true })
  }
}

const atomicWrite = (path: string, content: string): void => {
  const mode = existsSync(path) ? statSync(path).mode & 0o7777 : 0o600
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}`)
  try {
    const descriptor = openSync(temporaryPath, 'wx', mode)
    try {
      fchmodSync(descriptor, mode)
      writeSync(descriptor, content)
    } finally {
      closeSync(descriptor)
    }
    renameSync(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

const signalGroup = (processGroupId: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error
  }
}

// pnpm leads its own process group so a timeout also reaches the children it spawns.
const installProfile = async (): Promise<void> => {
  const startedAt = Date.now()
  log(`pnpm install in ${profileDirectory}`)
  // The reconciler edits the manifest on purpose; CI=true would otherwise make pnpm refuse to update the lockfile.
  const child = spawn('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], { cwd: profileDirectory, stdio: 'inherit', detached: true })
  const exited = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code, signal) => resolveExit(signal === null ? code : null))
  })
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<'timeout'>(resolveTimeout => {
    timer = setTimeout(() => resolveTimeout('timeout'), installTimeoutMs)
  })
  const outcome = await Promise.race([exited, timedOut])
  clearTimeout(timer)
  if (outcome === 'timeout' && child.pid !== undefined) {
    signalGroup(child.pid, 'SIGTERM')
    await sleep(5_000)
    signalGroup(child.pid, 'SIGKILL')
    await exited
    throw new Error(`pnpm install exceeded ${installTimeoutMs / 1000}s`)
  }
  if (outcome !== 0) throw new Error(`pnpm install failed with status ${String(outcome)}`)
  log(`installed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
}

const countOccurrences = (text: string, needle: string): number => text.split(needle).length - 1

/** The Cordis region between the markers is the seed's; everything around it stays local. */
const reconciledPatch = (target: string, source: string): string => {
  if (countOccurrences(source, patchStart) !== 1 || countOccurrences(source, patchEnd) !== 1) return target
  const sourceStart = source.indexOf(patchStart)
  const region = source.slice(sourceStart, source.indexOf(patchEnd, sourceStart) + patchEnd.length)
  const starts = countOccurrences(target, patchStart)
  const ends = countOccurrences(target, patchEnd)
  if (starts === 1 && ends === 1) {
    const start = target.indexOf(patchStart)
    return `${target.slice(0, start)}${region}${target.slice(target.indexOf(patchEnd, start) + patchEnd.length)}`
  }
  if (starts > 0 || ends > 0) throw new Error(`${join(profileDirectory, 'cordis.patch.yml')} has an incomplete managed Cordis region`)
  const legacyRegion = region.replace(`${patchStart}\n`, '').replace(`\n${patchEnd}`, '')
  if (target.includes(legacyRegion)) return target.replace(legacyRegion, () => region)
  if (target.includes('id: dshfiles-multi-host')) return target
  return `${target.trimEnd()}\n\n${region}\n`
}

const resolveLocalSpec = (spec: string): string => {
  const protocol = ['link:', 'file:'].find(prefix => spec.startsWith(prefix))
  if (protocol === undefined) return spec
  const target = spec.slice(protocol.length)
  return isAbsolute(target) ? spec : `${protocol}${resolve(seedDirectory, target)}`
}

const copyIfMissing = (source: string, target: string): void => {
  if (!existsSync(source)) return
  try {
    lstatSync(target)
    return
  } catch {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    copyFileSync(source, target, constants.COPYFILE_EXCL)
    chmodSync(target, 0o600)
    log(`seeded ${target}`)
  }
}

const readState = (): SyncState | undefined => {
  for (const filename of [stateFilename, legacyStateFilename]) {
    const path = join(profileDirectory, filename)
    if (existsSync(path)) return readJson(syncStateSchema, path)
  }
  return undefined
}

const syncSeededProfile = async (): Promise<void> => {
  const seed = readJson(seedManifestSchema, seedManifestPath)
  const desiredDependencies = Object.fromEntries(Object.entries(seed.dependencies).map(([name, spec]) => [name, resolveLocalSpec(spec)]))
  const desiredBundles = seed.dsh.profile.bundles
  for (const name of desiredBundles.filter(isOwned)) {
    const specifier = desiredDependencies[name]
    if (specifier === undefined || !specifier.startsWith('link:')) throw new Error(`Seed ${seedManifestPath} lists bundle ${name} without a link: dependency.`)
    const directory = specifier.slice('link:'.length)
    if (!existsSync(join(directory, 'cordis.patch.yml'))) throw new Error(`Seed bundle ${name} links to ${directory}, which is not an owned bundle.`)
  }

  if (!dryRun) {
    for (const filename of seededFiles) copyIfMissing(join(seedDirectory, filename), join(profileDirectory, filename))
    copyIfMissing(join(seedDirectory, 'ai-accounts.json'), join(dshHome, 'plugins/ai-accounts/accounts.json'))
  }
  if (!existsSync(manifestPath)) throw new Error(`Profile ${values.profile} has no package.json at ${manifestPath}.`)

  await withProfileLock(async () => {
    const currentText = readFileSync(manifestPath, 'utf8')
    const manifest = decodeJson(profileManifestSchema, currentText)
    const previous = readState()

    const dependencies = { ...manifest.dependencies }
    for (const [name, spec] of Object.entries(previous?.dependencies ?? {})) {
      if (!Object.hasOwn(desiredDependencies, name) && dependencies[name] === spec) delete dependencies[name]
    }
    for (const name of Object.keys(dependencies)) {
      if (isOwned(name) && !Object.hasOwn(desiredDependencies, name)) delete dependencies[name]
    }
    Object.assign(dependencies, desiredDependencies)
    const stale = (name: string): boolean => !desiredBundles.includes(name) && (isOwned(name) || (previous?.bundles.includes(name) ?? false))
    const keptBundles = manifest.dsh.profile.bundles.filter(name => !stale(name))
    const bundles = [...keptBundles, ...desiredBundles.filter(name => !keptBundles.includes(name))]
    const next = { ...manifest, dependencies, dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles } } }
    const nextText = `${JSON.stringify(next, null, 2)}\n`
    const nextHash = sha256(nextText)

    const patchPath = join(profileDirectory, 'cordis.patch.yml')
    const seedPatchPath = join(seedDirectory, 'cordis.patch.yml')
    const currentPatch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : undefined
    const nextPatch =
      currentPatch !== undefined && existsSync(seedPatchPath) ? reconciledPatch(currentPatch, readFileSync(seedPatchPath, 'utf8')) : currentPatch

    const added = bundles.filter(name => !manifest.dsh.profile.bundles.includes(name))
    const removed = manifest.dsh.profile.bundles.filter(name => !bundles.includes(name))
    const manifestChanged = nextText !== currentText
    const installNeeded = manifestChanged || previous?.installedManifestHash !== nextHash || !existsSync(join(profileDirectory, 'node_modules/.modules.yaml'))
    const state: SyncState = { dependencies: desiredDependencies, bundles: desiredBundles, installedManifestHash: previous?.installedManifestHash }
    const stateText = (value: SyncState): string => `${JSON.stringify(value, null, 2)}\n`
    const statePath = join(profileDirectory, stateFilename)

    if (!manifestChanged && !installNeeded && nextPatch === currentPatch && existsSync(statePath)) {
      log(`profile ${values.profile} is up to date with ${seedDirectory}`)
      return
    }
    log(`profile ${values.profile}: reconciling from ${seedDirectory}`)
    for (const name of added) console.log(`  + ${name}`)
    for (const name of removed) console.log(`  - ${name}`)
    if (nextPatch !== currentPatch) console.log('  ~ cordis.patch.yml managed region')
    if (dryRun) {
      if (installNeeded) console.log('  would run pnpm install')
      return
    }

    if (nextPatch !== undefined && nextPatch !== currentPatch) atomicWrite(patchPath, nextPatch)
    if (manifestChanged) atomicWrite(manifestPath, nextText)
    atomicWrite(statePath, stateText(state))
    rmSync(join(profileDirectory, legacyStateFilename), { force: true })
    if (!installNeeded) return
    await installProfile()
    atomicWrite(statePath, stateText({ ...state, installedManifestHash: nextHash }))
  })
}

const syncOwnedBundles = async (): Promise<void> => {
  if (!existsSync(manifestPath)) throw new Error(`Profile ${values.profile} has no package.json at ${manifestPath}.`)
  const ownedBundles = readdirSync(packagesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(packagesRoot, entry.name, 'cordis.patch.yml')))
    .map(entry => ({ name: `@dshfiles/${entry.name}`, directory: join(packagesRoot, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const selectedNames = values.bundle === undefined ? null : new Set(values.bundle)
  if (selectedNames !== null) {
    const unknown = [...selectedNames].filter(name => !ownedBundles.some(bundle => bundle.name === name))
    if (unknown.length > 0) throw new Error(`Unknown owned bundles: ${unknown.join(', ')}`)
  }
  const selectedBundles = selectedNames === null ? ownedBundles : ownedBundles.filter(bundle => selectedNames.has(bundle.name))
  const replaced = (name: string): boolean => (selectedNames === null ? isOwned(name) : selectedNames.has(name))

  await withProfileLock(async () => {
    const manifest = readJson(profileManifestSchema, manifestPath)
    const dependencies = Object.fromEntries([
      ...Object.entries(manifest.dependencies).filter(([name]) => !replaced(name)),
      ...selectedBundles.map(bundle => [bundle.name, `link:${bundle.directory}`]),
    ])
    const bundles = [...manifest.dsh.profile.bundles.filter(name => !replaced(name)), ...selectedBundles.map(bundle => bundle.name)]
    const next = { ...manifest, dependencies, dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles } } }

    log(`profile ${values.profile}: ${selectedBundles.length} owned bundles from the repository at ${repositoryRoot}`)
    for (const name of bundles.filter(name => !manifest.dsh.profile.bundles.includes(name))) console.log(`  + ${name}`)
    for (const name of manifest.dsh.profile.bundles.filter(name => isOwned(name) && !bundles.includes(name))) console.log(`  - ${name}`)
    if (dryRun) return
    atomicWrite(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
    await installProfile()
  })
}

const bundleSourcesSchema = z.object({ sources: z.array(z.string()), hashes: z.record(z.string(), z.string().nullable()).optional() })
const pluginScriptsSchema = z.looseObject({ scripts: z.record(z.string(), z.string()).default({}) })

/**
 * Linked plugins whose bundle is missing or was built from a workspace source that has since changed. DSH loads a dist
 * as it is, so after a base change or a failed build an old bundle boots against newer neighbours and fails on imports.
 * A source newer than its bundle counts only when its content differs from the hash the build recorded, since a jj
 * checkout rewrites files it leaves unchanged.
 */
const staleLinkedBundles = (): readonly string[] => {
  if (!existsSync(manifestPath)) return []
  const manifest = readJson(profileManifestSchema, manifestPath)
  return Object.entries(manifest.dependencies).flatMap(([name, spec]) => {
    if (!isOwned(name) || !spec.startsWith('link:')) return []
    const directory = resolve(profileDirectory, spec.slice('link:'.length))
    const packagePath = join(directory, 'package.json')
    if (!existsSync(packagePath) || readJson(pluginScriptsSchema, packagePath).scripts.build === undefined) return []
    const distDirectory = join(directory, 'dist')
    if (!existsSync(join(distDirectory, 'index.js'))) return [name]
    const stale = readdirSync(distDirectory)
      .filter(file => file.endsWith('.js.deps.json'))
      .some(file => {
        const bundlePath = join(distDirectory, file.slice(0, -'.deps.json'.length))
        if (!existsSync(bundlePath)) return true
        const builtAt = statSync(bundlePath).mtimeMs
        const dependencies = readJson(bundleSourcesSchema, join(distDirectory, file))
        return dependencies.sources
          .filter(source => !source.includes('node_modules/'))
          .some(source => {
            const sourcePath = resolve(directory, source)
            if (!existsSync(sourcePath)) return true
            if (statSync(sourcePath).mtimeMs <= builtAt) return false
            const recorded = dependencies.hashes?.[source]
            return recorded === undefined || recorded !== sha256(readFileSync(sourcePath))
          })
      })
    return stale ? [name] : []
  })
}

try {
  await (values.bundle === undefined && existsSync(seedManifestPath) ? syncSeededProfile() : syncOwnedBundles())
  const stale = staleLinkedBundles()
  if (stale.length > 0) {
    console.warn(`profile-sync: warning: ${stale.length} plugin bundles are older than their sources and DSH will load the old code: ${stale.join(', ')}`)
    console.warn(`profile-sync: run \`pnpm build --continue\` in ${repositoryRoot}, then restart DSH.`)
  }
} catch (error) {
  console.error(`profile-sync: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
