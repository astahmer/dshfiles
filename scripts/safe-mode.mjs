import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { LauncherConfig } from './launcher-config.mjs'

/**
 * Plugin safe mode: boot a profile's core DSH bundles plus the few owned bundles that own a durable data format, without
 * writing the profile itself. `start` composes a sibling `<profile>-safe` profile (its own manifest, install and a
 * filtered copy of the user's patch) and records what it left out; `stop` deletes that sibling. Dependency-free on
 * purpose: it must run when the repository's packages or a plugin build are broken.
 */

const MARKER = '.dshfiles-safe-mode.json'
const SUFFIX = '-safe'
const CORE_PREFIX = '@deepseek-ai/'
// Session logs written by this fork hold catalog references the stock reader cannot expand.
const DEFAULT_KEEP = ['@dshfiles/session-persistence-jsonl']
const PROFILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const TOP_LEVEL_ENTRY = /^- /
const ENTRY_ID = /^- id:\s*['"]?([^'"\s#]+)/
const INSERTED_NAME = /^\s+name:\s*['"]?([^'"\s#]+)/

const sha256 = text => createHash('sha256').update(text).digest('hex')
const readOptional = path => (existsSync(path) ? readFileSync(path, 'utf8') : '')

const atomicWrite = (path, text) => {
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, text, { mode: 0o600 })
  renameSync(temporary, path)
}

const readMarker = directory => {
  const path = join(directory, MARKER)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { status: 'unreadable' }
  }
}

const safeProfileName = profile => `${profile}${SUFFIX}`

/** The safe profile to boot instead of `profile`, or undefined when safe mode is off or never finished composing. */
export const activeSafeProfile = ({ home, profile }) => {
  const name = safeProfileName(profile)
  return readMarker(join(home, 'profiles', name))?.status === 'active' ? name : undefined
}

const runningPattern = name => `--profile(=| )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`

const isRunning = name => {
  const result = spawnSync('pgrep', ['-u', String(process.getuid()), '-f', '--', runningPattern(name)], { stdio: 'ignore' })
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error('Could not check running DSH processes; nothing changed')
  return result.status === 0
}

/** Leftovers of a start or stop that crashed between its steps; never a profile the user booted. */
const removeLeftovers = ({ profiles, name }) => {
  if (!existsSync(profiles)) return
  for (const entry of readdirSync(profiles)) {
    if (entry.startsWith(`.${name}.staging-`) || entry.startsWith(`.${name}.removing-`)) rmSync(join(profiles, entry), { recursive: true, force: true })
  }
}

const dshCommand = ({ dsh, config }) => {
  if (dsh) return { command: dsh, prefix: [] }
  if (config?.coreEntry) return { command: config.nodeBinary, prefix: [config.coreEntry] }
  return { command: 'dsh', prefix: [] }
}

const dumpConfig = ({ runner, home, profile }) => {
  const result = spawnSync(runner.command, [...runner.prefix, '--profile', profile, '--dump-config'], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw new Error(`Could not run ${runner.command}: ${result.error.message}. Pass --dsh <executable>.`)
  if (result.status !== 0) throw new Error(`dsh --dump-config failed for ${profile}:\n${result.stderr.trim().slice(-2000)}`)
  return { tree: result.stdout, warnings: result.stderr.trim() }
}

/** Splits a Cordis patch list into its top-level entries, each with the comment lines above it. */
const patchEntries = text => {
  const entries = []
  let pending = []
  for (const line of text.split('\n')) {
    if (TOP_LEVEL_ENTRY.test(line)) {
      entries.push([...pending, line])
      pending = []
    } else if (entries.length && /^\s+\S/.test(line)) entries.at(-1).push(...pending.splice(0), line)
    else pending.push(line)
  }
  return entries.map(lines => lines.join('\n'))
}

/**
 * Row ids a bundle's own patch layer targets (not inserts): the native rows it replaces or reconfigures. Read as text so a
 * bundle whose YAML no longer parses still names them.
 */
const bundleTargets = ({ profileDirectory, bundle }) => {
  const root = join(profileDirectory, 'node_modules', bundle)
  let patchFile = 'cordis.patch.yml'
  try {
    patchFile = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))?.dsh?.bundle?.patch ?? patchFile
  } catch {
    // A missing or broken manifest leaves the conventional file name.
  }
  return [...readOptional(join(root, patchFile)).matchAll(/^- id:\s*['"]?([^'"\s#]+)/gm)].map(match => match[1])
}

/**
 * Keeps the user's patch entries for rows the safe composition still has (ports, accounts, model defaults on native rows)
 * and drops entries for rows that left with their bundle, inserts of non-core modules, and entries for native rows a
 * turned-off bundle replaces: the user disabled `session-query-sqlite` because session-search owns `sessionQuery`, so
 * with session-search off the native row must come back.
 */
const filterPatch = ({ patch, rowIds, keptModules, replacedIds = new Set() }) => {
  const kept = []
  const dropped = []
  for (const entry of patchEntries(patch)) {
    const head = entry.split('\n').find(line => TOP_LEVEL_ENTRY.test(line)) ?? ''
    const id = ENTRY_ID.exec(head)?.[1]
    if (id !== undefined) {
      if (rowIds.has(id) && !replacedIds.has(id)) kept.push(entry)
      else dropped.push(id)
      continue
    }
    if (/^- insert:/.test(head)) {
      const modules = entry
        .split('\n')
        .map(line => INSERTED_NAME.exec(line)?.[1])
        .filter(Boolean)
      if (modules.every(name => name.startsWith(CORE_PREFIX) || keptModules.some(bundle => name === bundle || name.startsWith(`${bundle}/`)))) kept.push(entry)
      else dropped.push(`insert ${modules.join(', ')}`)
      continue
    }
    dropped.push(head.slice(0, 80))
  }
  return { kept, dropped }
}

const absoluteLink = (specifier, base) => {
  if (!specifier.startsWith('link:') && !specifier.startsWith('file:')) return specifier
  const [scheme, ...rest] = specifier.split(':')
  const target = rest.join(':')
  return `${scheme}:${isAbsolute(target) ? target : resolve(base, target)}`
}

const start = ({ home, profile, keep, runner }) => {
  const profiles = join(home, 'profiles')
  const source = join(profiles, profile)
  const name = safeProfileName(profile)
  const target = join(profiles, name)
  const sourceManifestText = readOptional(join(source, 'package.json'))
  if (!sourceManifestText) throw new Error(`No profile at ${source}; pass --profile <name> and --home <DSH home>`)
  const existing = readMarker(target)
  if (existsSync(target) && existing === undefined) throw new Error(`${target} exists and is not a safe-mode profile; move it aside first`)
  if (existing !== undefined && isRunning(name)) throw new Error(`DSH is running ${name}; stop it before recomposing safe mode`)
  removeLeftovers({ profiles, name })
  const manifest = JSON.parse(sourceManifestText)
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) throw new Error(`${source}/package.json lists no dsh.profile.bundles`)
  const unknown = keep.filter(bundle => !bundles.includes(bundle))
  if (unknown.length) throw new Error(`--keep names bundles this profile does not load: ${unknown.join(', ')}`)
  const keptBundles = bundles.filter(bundle => !bundle.startsWith(CORE_PREFIX) && (DEFAULT_KEEP.includes(bundle) || keep.includes(bundle)))
  const safeBundles = bundles.filter(bundle => bundle.startsWith(CORE_PREFIX) || keptBundles.includes(bundle))
  const disabledBundles = bundles.filter(bundle => !safeBundles.includes(bundle))
  const dependencies = Object.fromEntries(
    keptBundles.filter(bundle => manifest.dependencies?.[bundle]).map(bundle => [bundle, absoluteLink(manifest.dependencies[bundle], source)]),
  )
  const sourcePatch = readOptional(join(source, 'cordis.patch.yml'))
  const marker = {
    version: 1,
    status: 'composing',
    sourceProfile: profile,
    safeProfile: name,
    createdAt: new Date().toISOString(),
    source: { packageJsonSha256: sha256(sourceManifestText), patchSha256: sha256(sourcePatch) },
    keptBundles,
    disabledBundles,
    droppedPatchEntries: [],
  }
  const staging = join(profiles, `.${name}.staging-${process.pid}`)
  mkdirSync(staging, { recursive: true, mode: 0o700 })
  atomicWrite(join(staging, MARKER), `${JSON.stringify(marker, null, 2)}\n`)
  atomicWrite(
    join(staging, 'package.json'),
    `${JSON.stringify({ name: `dsh-profile-${name}`, private: true, dependencies, dsh: { profile: { bundles: safeBundles } } }, null, 2)}\n`,
  )
  const workspace = readOptional(join(source, 'pnpm-workspace.yaml'))
  if (workspace) atomicWrite(join(staging, 'pnpm-workspace.yaml'), workspace)
  atomicWrite(join(staging, 'cordis.patch.yml'), '[]\n')
  if (Object.keys(dependencies).length) {
    const install = spawnSync('pnpm', ['--dir', staging, 'install', '--prefer-offline', '--config.confirmModulesPurge=false'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    })
    if (install.status !== 0) {
      rmSync(staging, { recursive: true, force: true })
      throw new Error(`pnpm install of the kept bundles failed; nothing changed:\n${(install.stderr ?? install.error?.message ?? '').trim().slice(-2000)}`)
    }
  }
  if (existing !== undefined) renameSync(target, join(profiles, `.${name}.removing-${process.pid}`))
  renameSync(staging, target)
  removeLeftovers({ profiles, name })
  try {
    const rowIds = new Set([...dumpConfig({ runner, home, profile: name }).tree.matchAll(/^- id:\s*['"]?([^'"\s#]+)/gm)].map(match => match[1]))
    const replacedIds = new Set(disabledBundles.flatMap(bundle => bundleTargets({ profileDirectory: source, bundle })))
    const { kept, dropped } = filterPatch({ patch: sourcePatch, rowIds, keptModules: keptBundles, replacedIds })
    const header = [
      `# Safe mode for profile "${profile}": generated by scripts/safe-mode.mjs. Edits here are discarded by \`stop\`.`,
      `# Kept from ${join(source, 'cordis.patch.yml')}: entries for rows this composition still has.`,
    ].join('\n')
    atomicWrite(join(target, 'cordis.patch.yml'), kept.length ? `${header}\n${kept.join('\n')}\n` : `${header}\n[]\n`)
    const verified = dumpConfig({ runner, home, profile: name })
    marker.droppedPatchEntries = dropped
    marker.status = 'active'
    marker.compositionWarnings = verified.warnings ? verified.warnings.split('\n').slice(0, 50) : []
    atomicWrite(join(target, MARKER), `${JSON.stringify(marker, null, 2)}\n`)
    return marker
  } catch (error) {
    rmSync(target, { recursive: true, force: true })
    throw error
  }
}

const stop = ({ home, profile }) => {
  const profiles = join(home, 'profiles')
  const name = safeProfileName(profile)
  const target = join(profiles, name)
  const marker = readMarker(target)
  if (marker === undefined) {
    removeLeftovers({ profiles, name })
    if (existsSync(target)) throw new Error(`${target} is not a safe-mode profile; left untouched`)
    return { active: false }
  }
  if (isRunning(name)) throw new Error(`DSH is running ${name}; stop that DSH first, then run stop again`)
  const source = join(profiles, profile)
  const unchanged =
    marker.source?.packageJsonSha256 === sha256(readOptional(join(source, 'package.json'))) &&
    marker.source?.patchSha256 === sha256(readOptional(join(source, 'cordis.patch.yml')))
  renameSync(target, join(profiles, `.${name}.removing-${process.pid}`))
  removeLeftovers({ profiles, name })
  return { active: true, marker, unchanged }
}

const bootCommand = ({ config, home, profile }) => {
  const prefix = home === config?.dshHome ? '' : `DSH_HOME=${home} `
  return config?.coreEntry ? `${prefix}${join(config.sourceRoot, 'scripts/dsh-launcher')}` : `${prefix}dsh --profile ${profile}`
}

const main = () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: 'string' },
      home: { type: 'string' },
      keep: { type: 'string', multiple: true, default: [] },
      dsh: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  })
  const [command] = positionals
  if (!['start', 'stop', 'status'].includes(command ?? '') || positionals.length > 1)
    throw new Error(
      'Usage: node scripts/safe-mode.mjs start|stop|status [--profile <name>] [--home <DSH home>] [--keep <bundle>]... [--dsh <executable>] [--json]',
    )
  let config
  try {
    config = LauncherConfig.load()
  } catch {
    config = undefined
  }
  const home = resolve(values.home ?? process.env.DSH_HOME ?? config?.dshHome ?? join(process.env.HOME ?? '', '.dsh'))
  const profile = values.profile ?? config?.profile ?? 'web'
  if (!PROFILE_NAME.test(profile) || profile.endsWith(SUFFIX)) throw new Error(`Pass the profile you normally boot, not ${profile}`)
  const name = safeProfileName(profile)
  const print = (result, lines) => console.log(values.json ? JSON.stringify(result, null, 2) : lines.join('\n'))
  if (command === 'status') {
    const marker = readMarker(join(home, 'profiles', name))
    return print(marker ?? { status: 'off' }, [
      marker === undefined
        ? `Safe mode is off for ${profile}.`
        : `Safe mode is ${marker.status} for ${profile}: ${marker.disabledBundles?.length ?? 0} bundles off, kept ${marker.keptBundles?.join(', ') || 'none'}.`,
    ])
  }
  if (command === 'stop') {
    const result = stop({ home, profile })
    if (!result.active) return print({ status: 'off' }, [`Safe mode was not on for ${profile}; nothing to restore.`])
    return print({ status: 'off', profileUnchanged: result.unchanged, restored: result.marker.disabledBundles }, [
      `Safe mode is off: removed ${name}. Profile ${profile} ${result.unchanged ? 'is byte-identical to when safe mode started' : 'changed since safe mode started (safe mode never writes it)'}.`,
      `Its ${result.marker.disabledBundles.length} bundles load again on the next start. Stop the safe-mode DSH if it still runs, then boot normally:`,
      `  ${bootCommand({ config, home, profile })}`,
    ])
  }
  const marker = start({ home, profile, keep: values.keep, runner: dshCommand({ dsh: values.dsh, config }) })
  return print(marker, [
    `Safe mode is on for ${profile}: ${name} loads the core bundles${marker.keptBundles.length ? ` and ${marker.keptBundles.join(', ')}` : ''}.`,
    `Turned off ${marker.disabledBundles.length} bundles and ${marker.droppedPatchEntries.length} patch entries; ${join(home, 'profiles', profile)} is untouched.`,
    `Stop the running DSH yourself (it is not stopped for you), then boot safe mode${config?.coreEntry ? ' (the configured launcher boots it while safe mode is on)' : ''}:`,
    `  ${bootCommand({ config, home, profile: name })}`,
    `Restore every plugin: node ${fileURLToPath(import.meta.url)} stop --profile ${profile}${home === config?.dshHome ? '' : ` --home ${home}`}`,
  ])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077)
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Safe mode failed')
    process.exitCode = 1
  }
}
